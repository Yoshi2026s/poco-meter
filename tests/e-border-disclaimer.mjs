import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const template=readFileSync(new URL('../calculator/e-border-template.html',import.meta.url),'utf8');
const SHORT='本ツールは個人が作成した非公式ツールで、Pococha および運営会社とは関係ありません。数値は目安で、正確性や目標達成を保証しません。';

test('E帯ページに共通の短い免責文がそのまま1回だけ入っている',()=>{
  assert.equal(template.split(SHORT).length,2);
  assert.ok(!template.includes('本ツールは非公式です。計算結果は目安としてご利用ください。'));
});

test('E帯固有の注意（利用者が登録した値・画像を送信しない）を残している',()=>{
  assert.match(template,/E帯の記録は、利用者が画像の読み取りや手入力で登録した値です。/);
  assert.match(template,/画像を外部へ送信しません。/);
  assert.match(template,/画像は送信しません。/);
});

test('免責文はインラインスクリプトの外にある（スクリプトのハッシュに影響しない）',()=>{
  const scripts=[...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  assert.ok(!scripts.includes(SHORT));
  assert.ok(template.indexOf(SHORT)<template.indexOf('<script>__CORE__'));
});
