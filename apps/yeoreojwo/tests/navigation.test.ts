import test from 'node:test';
import assert from 'node:assert/strict';
import { appPath, readNavigation, rememberLoginIntent, safeReturnPath, signInHref, takeLoginIntent } from '../lib/navigation.ts';

function storage() { const values = new Map<string,string>(); return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}}; }
const intent = {kind:'interest' as const,requestId:'request-a',interested:true};
const key = '00000000-0000-4000-8000-000000000001';

test('login carries the same request and intended action in an encoded same-site return path', () => {
  const path = appPath(null,intent,key);
  const href = signInHref(path);
  assert.equal(new URL(href,'https://app.test').pathname,'/signin-with-chatgpt');
  assert.equal(new URL(href,'https://app.test').searchParams.get('return_to'),path);
  assert.deepEqual(readNavigation(new URL(path,'https://app.test').search),{requestId:'request-a',intent,resumeKey:key});
});

test('external, protocol-relative, backslash, control and encoded path redirects are rejected', () => {
  for(const unsafe of ['https://evil.test/','//evil.test/','/\\evil.test/','/\nevil.test','/%2f%2fevil.test','/%5cevil.test','/signin-with-chatgpt?return_to=https://evil.test']) assert.equal(safeReturnPath(unsafe),'/',unsafe);
  assert.equal(safeReturnPath('/?request=request-a&return_to=https://evil.test&unexpected=1'),'/?request=request-a');
  assert.equal(safeReturnPath('/?request=%3Cscript%3E'),'/');
});

test('URL intent alone cannot cause an interest write; a matching recent tab click is consumed once', () => {
  const tab = storage(); const search = new URL(appPath(null,intent,key),'https://app.test').search;
  assert.equal(takeLoginIntent(tab,search,1000),null);
  rememberLoginIntent(tab,intent,key,1000);
  assert.deepEqual(takeLoginIntent(tab,search,2000),intent);
  assert.equal(takeLoginIntent(tab,search,2000),null);
});

test('wrong tab, changed intent, expired return and blocked storage never auto-resume a mutation', () => {
  const tab = storage(); rememberLoginIntent(tab,intent,key,1000);
  const search = new URL(appPath(null,intent,key),'https://app.test').search;
  assert.equal(takeLoginIntent(storage(),search,2000),null);
  assert.equal(takeLoginIntent(tab,search.replace('resume=interest','resume=uninterest'),2000),null);
  assert.equal(takeLoginIntent(tab,search,1000+31*60_000),null);
  const blocked = {getItem:()=>{throw new Error('disabled');},setItem:()=>{throw new Error('disabled');},removeItem:()=>{throw new Error('disabled');}};
  assert.equal(rememberLoginIntent(blocked,intent,key),null); assert.equal(takeLoginIntent(blocked,search),null);
});

test('confirmation return describes a screen, never a confirmation command', () => {
  assert.deepEqual(readNavigation('?request=request-a&resume=confirm').intent,{kind:'confirm',requestId:'request-a'});
  assert.equal(readNavigation('?request=request-a&resume=cancel').intent,null);
});
