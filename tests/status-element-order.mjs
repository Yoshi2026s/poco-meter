import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../calculator/index.html',import.meta.url),'utf8');
const controller=html.indexOf('<script id="simple-menu-controller">');
for(const id of ['periodNotice','storageStatus','menuStatus','menuPreferenceStatus'])test(`${id} exists before inline initialization can access it`,()=>{
 const matches=[...html.matchAll(new RegExp('id="'+id+'"','g'))];
 assert.equal(matches.length,1,'The status must not have duplicate IDs');
 assert.ok(matches[0].index<controller,'The HTML parser must create the status before either inline controller runs');
});
