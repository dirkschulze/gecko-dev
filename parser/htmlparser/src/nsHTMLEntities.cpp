/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: NPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Netscape Public License
 * Version 1.1 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at
 * http://www.mozilla.org/NPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Communicator client code.
 *
 * The Initial Developer of the Original Code is 
 * Netscape Communications Corporation.
 * Portions created by the Initial Developer are Copyright (C) 1998
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the NPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the NPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

#include "nsHTMLEntities.h"



#include "nsString.h"
#include "nsCRT.h"
#include "nsAVLTree.h"

MOZ_DECL_CTOR_COUNTER(EntityNode)

struct EntityNode {
  const char* mStr; // never owns buffer
  PRInt32       mUnicode;
};

class EntityNameComparator: public nsAVLNodeComparator {
public:
  virtual ~EntityNameComparator(void) {}
  virtual PRInt32 operator()(const void* anItem1, const void* anItem2) {
    EntityNode* one = (EntityNode*)anItem1;
    EntityNode* two = (EntityNode*)anItem2;
    return nsCRT::strcmp(one->mStr, two->mStr);
  }
}; 

class EntityCodeComparator: public nsAVLNodeComparator {
public:
  virtual ~EntityCodeComparator(void) {}
  virtual PRInt32 operator()(const void* anItem1, const void* anItem2) {
    EntityNode* one = (EntityNode*)anItem1;
    EntityNode* two = (EntityNode*)anItem2;
    return (one->mUnicode - two->mUnicode);
  }
}; 


static PRInt32        gTableRefCount;
static nsAVLTree*     gEntityToCodeTree;
static nsAVLTree*     gCodeToEntityTree;
static EntityNameComparator* gNameComparator;
static EntityCodeComparator* gCodeComparator;

#define HTML_ENTITY(_name, _value) { #_name, _value },
static const EntityNode gEntityArray[] = {
#include "nsHTMLEntityList.h"
};
#undef HTML_ENTITY

#define NS_HTML_ENTITY_COUNT ((PRInt32)(sizeof(gEntityArray) / sizeof(gEntityArray[0])))

void
nsHTMLEntities::AddRefTable(void) 
{
  if (0 == gTableRefCount++) {
    if (! gNameComparator) {
      gNameComparator = new EntityNameComparator();
      gCodeComparator = new EntityCodeComparator();
      if (gNameComparator && gCodeComparator) {
        gEntityToCodeTree = new nsAVLTree(*gNameComparator, nsnull);
        gCodeToEntityTree = new nsAVLTree(*gCodeComparator, nsnull);
      }
      if (gEntityToCodeTree && gCodeToEntityTree) {
        PRInt32 index = -1;
        while (++index < NS_HTML_ENTITY_COUNT) {
          gEntityToCodeTree->AddItem(&(gEntityArray[index]));
          gCodeToEntityTree->AddItem(&(gEntityArray[index]));
        }
      }
    }
  }
}

void
nsHTMLEntities::ReleaseTable(void) 
{
  if (0 == --gTableRefCount) {
    if (gEntityToCodeTree) {
      delete gEntityToCodeTree;
      gEntityToCodeTree = nsnull;
    }
    if (gCodeToEntityTree) {
      delete gCodeToEntityTree;
      gCodeToEntityTree = nsnull;
    }
    if (gNameComparator) {
      delete gNameComparator;
      gNameComparator = nsnull;
    }
    if (gCodeComparator) {
      delete gCodeComparator;
      gCodeComparator = nsnull;
    }
  }
}

PRInt32 
nsHTMLEntities::EntityToUnicode(const nsCString& aEntity)
{
  NS_ASSERTION(gEntityToCodeTree, "no lookup table, needs addref");
  if (gEntityToCodeTree) {

    //this little piece of code exists because entities may or may not have the terminating ';'.
    //if we see it, strip if off for this test...

    if(';'==aEntity.Last()) {
      nsCAutoString temp(aEntity);
      temp.Truncate(aEntity.Length()-1);
      return EntityToUnicode(temp);
    }
      

    EntityNode node = {aEntity.get(), -1};
    EntityNode*  found = (EntityNode*)gEntityToCodeTree->FindItem(&node);
    if (found) {
      NS_ASSERTION(!nsCRT::strcmp(found->mStr, aEntity.get()), "bad tree");
      return found->mUnicode;
    }
  }
  return -1;
}


PRInt32 
nsHTMLEntities::EntityToUnicode(const nsAString& aEntity) {
  nsCAutoString theEntity; theEntity.AssignWithConversion(aEntity);
  if(';'==theEntity.Last()) {
    theEntity.Truncate(theEntity.Length()-1);
  }

  return EntityToUnicode(theEntity);
}


const char*
nsHTMLEntities::UnicodeToEntity(PRInt32 aUnicode)
{
  NS_ASSERTION(gCodeToEntityTree, "no lookup table, needs addref");
  if (gCodeToEntityTree) {
    EntityNode node = { "", -1 };
    EntityNode*  found = (EntityNode*)gCodeToEntityTree->FindItem(&node);
    if (found) {
      NS_ASSERTION(found->mUnicode == aUnicode, "bad tree");
      return found->mStr;
    }
  }
  return nsnull;
}

#ifdef NS_DEBUG
#include <stdio.h>

class nsTestEntityTable {
public:
   nsTestEntityTable() {
     PRInt32 value;
     nsHTMLEntities::AddRefTable();

     // Make sure we can find everything we are supposed to
     for (int i = 0; i < NS_HTML_ENTITY_COUNT; ++i) {
       nsAutoString entity; entity.AssignWithConversion(gEntityArray[i].mStr);

       value = nsHTMLEntities::EntityToUnicode(entity);
       NS_ASSERTION(value != -1, "can't find entity");
       NS_ASSERTION(value == gEntityArray[i].mUnicode, "bad unicode value");

       entity.AssignWithConversion(nsHTMLEntities::UnicodeToEntity(value));
       NS_ASSERTION(entity.EqualsWithConversion(gEntityArray[i].mStr), "bad entity name");
     }

     // Make sure we don't find things that aren't there
     value = nsHTMLEntities::EntityToUnicode(nsCAutoString("@"));
     NS_ASSERTION(value == -1, "found @");
     value = nsHTMLEntities::EntityToUnicode(nsCAutoString("zzzzz"));
     NS_ASSERTION(value == -1, "found zzzzz");
     nsHTMLEntities::ReleaseTable();
   }
};
//nsTestEntityTable validateEntityTable;
#endif

