/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Preferences.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/osfile.jsm");


const ROOT_BRANCH = "datareporting.";
const POLICY_BRANCH = ROOT_BRANCH + "policy.";
const SESSIONS_BRANCH = ROOT_BRANCH + "sessions.";
const HEALTHREPORT_BRANCH = ROOT_BRANCH + "healthreport.";
const HEALTHREPORT_LOGGING_BRANCH = HEALTHREPORT_BRANCH + "logging.";
const DEFAULT_LOAD_DELAY_MSEC = 10 * 1000;
const DEFAULT_LOAD_DELAY_FIRST_RUN_MSEC = 60 * 1000;

/**
 * The Firefox Health Report XPCOM service.
 *
 * External consumers will be interested in the "reporter" property of this
 * service. This property is a `HealthReporter` instance that powers the
 * service. The property may be null if the Health Report service is not
 * enabled.
 *
 * EXAMPLE USAGE
 * =============
 *
 * let reporter = Cc["@mozilla.org/datareporting/service;1"]
 *                  .getService(Ci.nsISupports)
 *                  .wrappedJSObject
 *                  .healthReporter;
 *
 * if (reporter.haveRemoteData) {
 *   // ...
 * }
 *
 * IMPLEMENTATION NOTES
 * ====================
 *
 * In order to not adversely impact application start time, the `HealthReporter`
 * instance is not initialized until a few seconds after "final-ui-startup."
 * The exact delay is configurable via preferences so it can be adjusted with
 * a hotfix extension if the default value is ever problematic. Because of the
 * overhead with the initial creation of the database, the first run is delayed
 * even more than subsequent runs. This does mean that the first moments of
 * browser activity may be lost by FHR.
 *
 * Shutdown of the `HealthReporter` instance is handled completely within the
 * instance (it registers observers on initialization). See the notes on that
 * type for more.
 */
this.DataReportingService = function () {
  this.wrappedJSObject = this;

  this._quitting = false;

  this._os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);

  this._clientID = null;
  this._loadClientIdTask = null;
  this._saveClientIdTask = null;

  this._stateDir = null;
  this._stateFilePath = null;
}

DataReportingService.prototype = Object.freeze({
  classID: Components.ID("{41f6ae36-a79f-4613-9ac3-915e70f83789}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference]),

  //---------------------------------------------
  // Start of policy listeners.
  //---------------------------------------------

  /**
   * Called when policy requests data upload.
   */
  onRequestDataUpload: function (request) {
    if (!this.healthReporter) {
      return;
    }

    this.healthReporter.requestDataUpload(request);
  },

  onNotifyDataPolicy: function (request) {
    Observers.notify("datareporting:notify-data-policy:request", request);
  },

  onRequestRemoteDelete: function (request) {
    if (!this.healthReporter) {
      return;
    }

    this.healthReporter.deleteRemoteData(request);
  },

  //---------------------------------------------
  // End of policy listeners.
  //---------------------------------------------

  observe: function observe(subject, topic, data) {
    switch (topic) {
      case "app-startup":
        this._os.addObserver(this, "profile-after-change", true);
        break;

      case "profile-after-change":
        this._os.removeObserver(this, "profile-after-change");

        try {
          this._prefs = new Preferences(HEALTHREPORT_BRANCH);

          // We don't initialize the sessions recorder unless Health Report is
          // around to provide pruning of data.
          //
          // FUTURE consider having the SessionsRecorder always enabled and/or
          // living in its own XPCOM service.
          if (this._prefs.get("service.enabled", true)) {
            this.sessionRecorder = new SessionRecorder(SESSIONS_BRANCH);
            this.sessionRecorder.onStartup();
          }

          // We can't interact with prefs until after the profile is present.
          let policyPrefs = new Preferences(POLICY_BRANCH);
          this.policy = new DataReportingPolicy(policyPrefs, this._prefs, this);

          this._stateDir = OS.Path.join(OS.Constants.Path.profileDir, "datareporting");
          this._stateFilePath = OS.Path.join(this._stateDir, "state.json");

          this._os.addObserver(this, "sessionstore-windows-restored", true);
        } catch (ex) {
          Cu.reportError("Exception when initializing data reporting service: " +
                         CommonUtils.exceptionStr(ex));
        }
        break;

      case "sessionstore-windows-restored":
        this._os.removeObserver(this, "sessionstore-windows-restored");
        this._os.addObserver(this, "quit-application", false);

        let policy = this.policy;
        policy.startPolling();

        // Don't initialize Firefox Health Reporter collection and submission
        // service unless it is enabled.
        if (!this._prefs.get("service.enabled", true)) {
          return;
        }

        let haveFirstRun = this._prefs.get("service.firstRun", false);
        let delayInterval;

        if (haveFirstRun) {
          delayInterval = this._prefs.get("service.loadDelayMsec") ||
                          DEFAULT_LOAD_DELAY_MSEC;
        } else {
          delayInterval = this._prefs.get("service.loadDelayFirstRunMsec") ||
                          DEFAULT_LOAD_DELAY_FIRST_RUN_MSEC;
        }

        // Delay service loading a little more so things have an opportunity
        // to cool down first.
        this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        this.timer.initWithCallback({
          notify: function notify() {
            delete this.timer;

            // There could be a race between "quit-application" firing and
            // this callback being invoked. We close that door.
            if (this._quitting) {
              return;
            }

            // Side effect: instantiates the reporter instance if not already
            // accessed.
            //
            // The instance installs its own shutdown observers. So, we just
            // fire and forget: it will clean itself up.
            let reporter = this.healthReporter;
            policy.ensureUserNotified();
          }.bind(this),
        }, delayInterval, this.timer.TYPE_ONE_SHOT);

        break;

      case "quit-application":
        this._os.removeObserver(this, "quit-application");
        this._quitting = true;

        // Shutdown doesn't clear pending timers. So, we need to explicitly
        // cancel our health reporter initialization timer or else it will
        // attempt initialization after shutdown has commenced. This would
        // likely lead to stalls or crashes.
        if (this.timer) {
          this.timer.cancel();
        }

        if (this.policy) {
          this.policy.stopPolling();
        }
        break;
    }
  },

  /**
   * The HealthReporter instance associated with this service.
   *
   * If the service is disabled, this will return null.
   *
   * The obtained instance may not be fully initialized.
   */
  get healthReporter() {
    if (!this._prefs.get("service.enabled", true)) {
      return null;
    }

    if ("_healthReporter" in this) {
      return this._healthReporter;
    }

    try {
      this._loadHealthReporter();
    } catch (ex) {
      this._healthReporter = null;
      Cu.reportError("Exception when obtaining health reporter: " +
                     CommonUtils.exceptionStr(ex));
    }

    return this._healthReporter;
  },

  _loadHealthReporter: function () {
    // This should never happen. It was added to help trace down bug 924307.
    if (!this.policy) {
      throw new Error("this.policy not set.");
    }

    let ns = {};
    // Lazy import so application startup isn't adversely affected.

    Cu.import("resource://gre/modules/Task.jsm", ns);
    Cu.import("resource://gre/modules/HealthReport.jsm", ns);
    Cu.import("resource://gre/modules/Log.jsm", ns);

    // How many times will we rewrite this code before rolling it up into a
    // generic module? See also bug 451283.
    const LOGGERS = [
      "Services.DataReporting",
      "Services.HealthReport",
      "Services.Metrics",
      "Services.BagheeraClient",
      "Sqlite.Connection.healthreport",
    ];

    let loggingPrefs = new Preferences(HEALTHREPORT_LOGGING_BRANCH);
    if (loggingPrefs.get("consoleEnabled", true)) {
      let level = loggingPrefs.get("consoleLevel", "Warn");
      let appender = new ns.Log.ConsoleAppender();
      appender.level = ns.Log.Level[level] || ns.Log.Level.Warn;

      for (let name of LOGGERS) {
        let logger = ns.Log.repository.getLogger(name);
        logger.addAppender(appender);
      }
    }

    if (loggingPrefs.get("dumpEnabled", false)) {
      let level = loggingPrefs.get("dumpLevel", "Debug");
      let appender = new ns.Log.DumpAppender();
      appender.level = ns.Log.Level[level] || ns.Log.Level.Debug;

      for (let name of LOGGERS) {
        let logger = ns.Log.repository.getLogger(name);
        logger.addAppender(appender);
      }
    }

    this._healthReporter = new ns.HealthReporter(HEALTHREPORT_BRANCH,
                                                 this.policy,
                                                 this.sessionRecorder);

    // Wait for initialization to finish so if a shutdown occurs before init
    // has finished we don't adversely affect app startup on next run.
    this._healthReporter.init().then(function onInit() {
      this._prefs.set("service.firstRun", true);
    }.bind(this));
  },

  _loadClientID: Task.async(function* () {
    if (this._loadClientIdTask) {
      return this._loadClientIdTask;
    }

    // Previously we had the stable client ID managed in FHR.
    // As we want to start correlating FHR and telemetry data (and moving towards
    // unifying the two), we moved the ID management to the datareporting
    // service. Consequently, we try to import the FHR ID first, so we can keep
    // using it.

    // Try to load the client id from the DRS state file first.
    try {
      let state = yield CommonUtils.readJSON(this._stateFilePath);
      if (state && 'clientID' in state && typeof(state.clientID) == 'string') {
        this._clientID = state.clientID;
        this._loadClientIdTask = null;
        return this._clientID;
      }
    } catch (e) {
      // fall through to next option
    }

    // If we dont have DRS state yet, try to import from the FHR state.
    try {
      let fhrStatePath = OS.Path.join(OS.Constants.Path.profileDir, "healthreport", "state.json");
      let state = yield CommonUtils.readJSON(fhrStatePath);
      if (state && 'clientID' in state && typeof(state.clientID) == 'string') {
        this._clientID = state.clientID;
        this._loadClientIdTask = null;
        this._saveClientID();
        return this._clientID;
      }
    } catch (e) {
      // fall through to next option
    }

    // We dont have an id from FHR yet, generate a new ID.
    this._clientID = CommonUtils.generateUUID();
    this._loadClientIdTask = null;
    this._saveClientIdTask = this._saveClientID();

    // Wait on persisting the id. Otherwise failure to save the ID would result in
    // the client creating and subsequently sending multiple IDs to the server.
    // This would appear as multiple clients submitting similar data, which would
    // result in orphaning.
    yield this._saveClientIdTask;

    return this._clientID;
  }),

  _saveClientID: Task.async(function* () {
    let obj = { clientID: this._clientID };
    yield OS.File.makeDir(this._stateDir);
    yield CommonUtils.writeJSON(obj, this._stateFilePath);
    this._saveClientIdTask = null;
  }),

  /**
   * This returns a promise resolving to the the stable client ID we use for
   * data reporting (FHR & Telemetry). Previously exising FHR client IDs are
   * migrated to this.
   *
   * @return Promise<string> The stable client ID.
   */
  getClientID: function() {
    if (this._loadClientIdTask) {
      return this._loadClientIdTask;
    }

    if (!this._clientID) {
      this._loadClientIdTask = this._loadClientID();
      return this._loadClientIdTask;
    }

    return Promise.resolve(this._clientID);
  },

  /**
   * Reset the stable client id.
   *
   * @return Promise<string> The new client ID.
   */
  resetClientID: Task.async(function* () {
    yield this._loadClientIdTask;
    yield this._saveClientIdTask;

    this._clientID = CommonUtils.generateUUID();
    this._saveClientIdTask = this._saveClientID();
    yield this._saveClientIdTask;

    return this._clientID;
  }),

  /*
   * Simulate a restart of the service. This is for testing only.
   */
  _reset: Task.async(function* () {
    yield this._loadClientIdTask;
    yield this._saveClientIdTask;
    this._clientID = null;
  }),
});

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([DataReportingService]);

#define MERGED_COMPARTMENT

#include ../common/observers.js
;
#include policy.jsm
;
#include sessions.jsm
;

