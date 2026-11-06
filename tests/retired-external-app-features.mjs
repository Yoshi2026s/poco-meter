import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEngine,engine,plain,html} from './calculator-harness.mjs';

const KEY='pococha-meter-calc-v1',HUD_KEY='pococha-meter-hud-v1';
const settings=()=>({...plain(engine().state),target:'500000',current:'123456',deadline:'22:00',pick:'',seedVer:3,seedVer13:1});
const retiredIds=['floatHudToggle','launchOtherApp','floatingHudStatus','appLaunchPanel','appLaunchMode','appLaunchValue','appLaunchValueLabel','appLaunchHelp','appLaunchLink','appLaunchCheck','appLaunchStatus','closeAppLaunch','restorePocochaLaunch','mobileHudHelp','mobileHudCompatibility','mobileHudToolUrl','copyMobileHudUrl','pipTestPanel','pipVideoMode','preparePipTest','openPipTest','stopPipTest','pipTestVideo','pipTestStatus','preparePipSnapshot','resumePipPlayback','showPipVideo'];

function memory(entries={}){
  const values=new Map([[KEY,JSON.stringify(settings())],...Object.entries(entries)]),reads=[],writes=[];
  return {values,reads,writes,localStorage:{getItem:key=>{reads.push(key);return values.get(key)??null;},setItem:(key,value)=>{writes.push(key);values.set(key,value);}}};
}
function page(m=memory(),phone=false){return pageEngine(undefined,{navigator:{onLine:false},URL,localStorage:m.localStorage,...(phone?{matchMedia:query=>({matches:query.includes('max-width:700px')})}:{})});}
function input(p,id,value){p.element(id).value=value;p.element(id).dispatchEvent(new Event('input'));}

test('Shipped HTML contains no retired controls, styles, instructions or media controller',()=>{
  for(const id of retiredIds)assert.doesNotMatch(html,new RegExp('\\b'+id+'\\b'),id+' must be absent from markup, styles and script');
  assert.doesNotMatch(html,/他アプリで表示|他アプリを起動|他アプリで常時表示|互換小窓|小窓を開く|小窓表示中|ショートカット名|shortcuts:\/\//);
  assert.doesNotMatch(html,/floatingHudController|launchDestination|app-launch-open|app-launch-actions|pococha-meter-app-launch-v1|pococha-meter-pip-mode-v1/);
  assert.doesNotMatch(html,/requestPictureInPicture|exitPictureInPicture|pictureInPictureElement|pictureInPictureEnabled|webkitSetPresentationMode|webkitPresentationMode|webkitSupportsPresentationMode|MediaRecorder|captureStream|enterpictureinpicture|leavepictureinpicture/);
});

for(const phone of [false,true])test((phone?'Phone':'Desktop')+' initializes the normal HUD without local media elements',()=>{
  const p=page(memory(),phone);assert.ok(p.element('mini'));assert.equal(p.element('mini').classList.contains('show'),true);assert.equal(p.element('mini').getAttribute('aria-hidden'),'false');
  assert.equal(p.nodes.filter(node=>['CANVAS','VIDEO'].includes(node.tagName)).length,0,'Initialization creates no recording canvas or video');
  for(const id of retiredIds)assert.equal(p.element(id),undefined);
  for(const id of ['targetMini','currentMini','hudToggle','miniT','miniNowTime'])assert.ok(p.element(id),id+' remains');
});

test('Turning the ordinary HUD OFF preserves independent item hints and remains OFF on restart',()=>{
  const m=memory(),p=page(m);p.element('itemsHudToggle').click();assert.equal(p.element('itemsWindow').hidden,false);p.element('hudToggle').click();
  assert.equal(p.element('itemsWindow').hidden,false);assert.equal(p.element('mini').classList.contains('hud-collapsed'),true);assert.equal(m.values.get(HUD_KEY),'off');assert.equal(m.values.get('pococha-meter-items-window-v1'),'on');
  const fresh=page(m);assert.equal(fresh.element('hudVisibility').value,'off');assert.equal(fresh.element('itemsWindow').hidden,false);fresh.element('hudToggle').click();assert.equal(fresh.element('mini').classList.contains('hud-collapsed'),false);
});

test('Normal HUD input still updates calculation, saves values and survives desktop restart',()=>{
  const m=memory(),p=page(m);input(p,'targetMini','900000');input(p,'currentMini','400000');const saved=JSON.parse(m.values.get(KEY));
  assert.equal(saved.target,'900000');assert.equal(saved.current,'400000');assert.equal(p.element('remain').textContent,'500K');assert.equal(p.element('miniR').textContent,p.element('remain').textContent);
  const fresh=page(m);assert.equal(fresh.element('targetMini').value,'900,000');assert.equal(fresh.element('currentMini').value,'400,000');assert.equal(fresh.element('miniR').textContent,'500K');
  fresh.document.hidden=true;fresh.dispatchDocument('visibilitychange');fresh.document.hidden=false;fresh.dispatchDocument('visibilitychange');fresh.dispatchWindow('pageshow',{persisted:true});fresh.tick(1000);assert.equal(fresh.element('miniR').textContent,'500K');
});

test('Old retired preferences do not activate code or get read/written during HUD use',()=>{
  const oldKeys=['pococha-meter-app-launch-v1','pococha-meter-pip-mode-v1'],m=memory({[oldKeys[0]]:'{"mode":"url","url":"https://example.com"}',[oldKeys[1]]:'snapshot'}),p=page(m);
  p.element('hudToggle').click();p.element('hudToggle').click();input(p,'currentMini','200000');p.dispatchWindow('focus');p.dispatchWindow('pagehide',{persisted:false});
  for(const key of oldKeys){assert.equal(m.reads.includes(key),false);assert.equal(m.writes.includes(key),false);}
  assert.equal(p.nodes.filter(node=>['CANVAS','VIDEO'].includes(node.tagName)).length,0);
});
