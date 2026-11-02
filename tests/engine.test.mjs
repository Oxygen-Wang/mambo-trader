import test from 'node:test';
import assert from 'node:assert/strict';
import {newAccount,placeOrder,matchOrders,cancelOrder,valuation,availableShares,feeFor,tradingTime,symbolOf,canTrade} from '../public/engine.mjs';

const monday = new Date('2026-11-02T10:00:00+08:00');
const nextDay = new Date('2026-11-03T10:00:00+08:00');
const quote=(timestamp='20261102100000')=>({symbol:'sh600036',name:'招商银行',price:40,volume:10000000,timestamp,limitUp:44,limitDown:36});
const buy=(a,qty=100,limit=41)=>placeOrder(a,{symbol:'600036',side:'BUY',qty,limit},quote(),monday);

test('初始1000万，买入资金含费用冻结，撤单完整释放',()=>{
  const a=newAccount();const o=buy(a,1000);
  assert.equal(a.cash,10000000);
  assert.equal(valuation(a,{},monday).availableCash,10000000-41000-feeFor('BUY',41000));
  cancelOrder(a,o.id);assert.equal(valuation(a,{},monday).availableCash,10000000);
});
test('拒绝超额、非整手、错误方向、非有限数、ST和非主板',()=>{
  const a=newAccount();assert.throws(()=>buy(a,100000000),/资金不足/);
  assert.throws(()=>buy(a,101),/100 股/);
  assert.throws(()=>placeOrder(a,{symbol:'600036',side:'BAD',qty:100,limit:40},quote(),monday));
  assert.throws(()=>buy(a,100,Infinity));
  assert.throws(()=>placeOrder(a,{symbol:'600036',side:'BUY',qty:100,limit:40},{...quote(),name:'ST测试'},monday));
  assert.throws(()=>placeOrder(a,{symbol:'300750',side:'BUY',qty:100,limit:40},quote(),monday));
});
test('休市和陈旧行情不能产生真实行情模拟成交',()=>{
  const a=newAccount();buy(a);
  matchOrders(a,{'sh600036':quote()},new Date('2026-11-02T19:00:00+08:00'));
  assert.equal(a.trades.length,0);assert.equal(a.orders[0].status,'pending');
  matchOrders(a,{'sh600036':quote('20261030100000')},monday);
  assert.equal(a.trades.length,0);
  assert.equal(tradingTime(new Date('2026-11-07T10:00:00+08:00')),false);
  assert.equal(tradingTime(new Date('2026-11-02T12:00:00+08:00')),false);
});
test('成交计滑点与费用，T+1硬约束，卖出只操作可卖批次',()=>{
  const a=newAccount();buy(a);matchOrders(a,{'sh600036':quote()},monday);
  assert.equal(a.trades.length,1);assert.equal(a.trades[0].price,40.02);
  assert.equal(a.cash,10000000-4002-feeFor('BUY',4002));
  assert.equal(availableShares(a,'sh600036','2026-11-02'),0);
  assert.throws(()=>placeOrder(a,{symbol:'600036',side:'SELL',qty:100,limit:39},quote(),monday),/可卖股数不足/);
  assert.equal(availableShares(a,'sh600036','2026-11-03'),100);
  placeOrder(a,{symbol:'600036',side:'SELL',qty:100,limit:39},quote('20261103100000'),nextDay);
  assert.equal(availableShares(a,'sh600036','2026-11-03'),0);
  matchOrders(a,{'sh600036':quote('20261103100000')},nextDay);
  assert.equal(a.trades.length,2);assert.equal(Object.keys(a.positions).length,0);
  assert.equal(a.cash,Number((10000000-4002-feeFor('BUY',4002)+3998-feeFor('SELL',3998)).toFixed(2)));
});
test('限价、涨停买入和无成交量不会伪造成交',()=>{
  const a=newAccount();buy(a,100,39);matchOrders(a,{'sh600036':quote()},monday);assert.equal(a.trades.length,0);
  const b=newAccount();buy(b,100,45);matchOrders(b,{'sh600036':{...quote(),price:44}},monday);assert.equal(b.trades.length,0);
  matchOrders(b,{'sh600036':{...quote(),volume:0}},monday);assert.equal(b.trades.length,0);
});
test('演示撮合显式标注，独立账户不污染真实账本',()=>{
  const live=newAccount(),demo=newAccount('demo','demo');buy(demo);
  matchOrders(demo,{'sh600036':quote()},new Date('2026-11-02T19:00:00+08:00'),true);
  assert.equal(demo.trades.length,1);assert.equal(demo.trades[0].demo,true);assert.equal(live.trades.length,0);assert.equal(live.cash,10000000);
});
test('观察池支持沪深北，交易权限保持独立',()=>{
  for(const [code,symbol] of [['600036','sh600036'],['300750','sz300750'],['688981','sh688981'],['920002','bj920002'],['430047','bj430047']])assert.equal(symbolOf(code),symbol);
  assert.equal(canTrade('sh600036'),true);assert.equal(canTrade('sz300750'),false);
  assert.throws(()=>symbolOf('510300'));assert.throws(()=>symbolOf('900901'));
});
