/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 *
 * The contents of this file are subject to the Netscape Public License
 * Version 1.0 (the "License"); you may not use this file except in
 * compliance with the License.  You may obtain a copy of the License at
 * http://www.mozilla.org/NPL/
 *
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied.  See
 * the License for the specific language governing rights and limitations
 * under the License.
 *
 * The Original Code is Mozilla Communicator client code.
 *
 * The Initial Developer of the Original Code is Netscape Communications
 * Corporation.  Portions created by Netscape are Copyright (C) 1998
 * Netscape Communications Corporation.  All Rights Reserved.
 */

/* Do not edit - generated by gentags.pl */
#include <string.h>
#include "nsHTMLTags.h"

static char* tagTable[] = {
  "A", "ABBR", "ACRONYM", "ADDRESS", "APPLET", "AREA", "B", "BASE", 
  "BASEFONT", "BDO", "BGSOUND", "BIG", "BLINK", "BLOCKQUOTE", "BODY", "BR", 
  "BUTTON", "CAPTION", "CENTER", "CITE", "CODE", "COL", "COLGROUP", "DD", 
  "DEL", "DFN", "DIR", "DIV", "DL", "DT", "EM", "EMBED", "FIELDSET", "FONT", 
  "FORM", "FRAME", "FRAMESET", "H1", "H2", "H3", "H4", "H5", "H6", "HEAD", 
  "HR", "HTML", "I", "IFRAME", "ILAYER", "IMG", "INPUT", "INS", "ISINDEX", 
  "KBD", "KEYGEN", "LABEL", "LAYER", "LEGEND", "LI", "LINK", "LISTING", 
  "MAP", "MENU", "META", "MULTICOL", "NEXTID", "NOBR", "NOEMBED", "NOFRAMES", 
  "NOLAYER", "NOSCRIPT", "OBJECT", "OL", "OPTGROUP", "OPTION", "P", "PARAM", 
  "PLAINTEXT", "PRE", "Q", "S", "SAMP", "SCRIPT", "SELECT", "SERVER", 
  "SMALL", "SOUND", "SPACER", "SPAN", "STRIKE", "STRONG", "STYLE", "SUB", 
  "SUP", "TABLE", "TBODY", "TD", "TEXTAREA", "TFOOT", "TH", "THEAD", "TITLE", 
  "TR", "TT", "U", "UL", "VAR", "WBR", "XMP"
};

nsHTMLTag NS_TagToEnum(const char* aTagName) {
  int low = 0;
  int high = NS_HTML_TAG_MAX - 1;
  while (low <= high) {
    int middle = (low + high) >> 1;
    int result = strcmp(aTagName, tagTable[middle]);
    if (result == 0)
      return (nsHTMLTag) (middle + 1);
    if (result < 0)
      high = middle - 1; 
    else
      low = middle + 1; 
  }
  return eHTMLTag_userdefined;
}

const char* NS_EnumToTag(nsHTMLTag aTagID) {
  if ((int(aTagID) <= 0) || (int(aTagID) > NS_HTML_TAG_MAX)) {
    return 0;
  }
  return tagTable[int(aTagID) - 1];
}

#ifdef NS_DEBUG
#include <stdio.h>

class nsTestTagTable {
public:
   nsTestTagTable() {
     const char *tag;
     nsHTMLTag id;

     // Make sure we can find everything we are supposed to
     for (int i = 0; i < NS_HTML_TAG_MAX; i++) {
       tag = tagTable[i];
       id = NS_TagToEnum(tag);
       NS_ASSERTION(id != eHTMLTag_userdefined, "can't find tag id");
       const char* check = NS_EnumToTag(id);
       NS_ASSERTION(check == tag, "can't map id back to tag");
     }

     // Make sure we don't find things that aren't there
     id = NS_TagToEnum("@");
     NS_ASSERTION(id == eHTMLTag_userdefined, "found @");
     id = NS_TagToEnum("zzzzz");
     NS_ASSERTION(id == eHTMLTag_userdefined, "found @");

     tag = NS_EnumToTag((nsHTMLTag) 0);
     NS_ASSERTION(0 == tag, "found enum 0");
     tag = NS_EnumToTag((nsHTMLTag) -1);
     NS_ASSERTION(0 == tag, "found enum -1");
     tag = NS_EnumToTag((nsHTMLTag) (NS_HTML_TAG_MAX + 1));
     NS_ASSERTION(0 == tag, "found past max enum");
   }
};
nsTestTagTable validateTagTable;
#endif

