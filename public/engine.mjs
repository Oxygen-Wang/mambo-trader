const randomUUID = () => globalThis.crypto.randomUUID();

export const FEES = { commission: 0.00025, minimum: 5, stampSell: 0.0005, transfer: 0.00001, slippage: 0.0005 };
export function bjTime(now = new Date()) {
  const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  return { date: p.slice(0, 10), time: p.slice(11, 19), stamp: p.replace(/\D/g, ''), weekday: new Date(p.slice(0, 10) + 'T00:00:00Z').getUTCDay() };
}
export function tradingTime(now = new Date()) {
  const b = bjTime(now);
  return b.weekday > 0 && b.weekday < 6 && ((b.time >= '09:30:00' && b.time < '11:30:00') || (b.time >= '13:00:00' && b.time < '14:57:00'));
}
export function symbolOf(value) {
  let s = String(value || '').trim().toLowerCase();
  if (/^\d{6}$/.test(s)) s = (s.startsWith('6') ? 'sh' : /^[489]/.test(s) ? 'bj' : 'sz') + s;
  if (!/^(sh(?:60|68)\d{4}|sz(?:00|30)\d{4}|bj(?:43|83|87|88|92)\d{4})$/.test(s)) throw new Error('请输入沪深北 A 股六位代码，例如 600036、300750、688981、920002；指数、ETF 和 B 股暂不支持。');
  return s;
}
export function canTrade(symbol) { return /^(sh60\d{4}|sz00\d{4})$/.test(symbol); }
export function newAccount(name = '主账户 · 1000万挑战', mode = 'live', model = null) {
  return { id: randomUUID(), name, mode, model, initial: 10000000, cash: 10000000, createdAt: new Date().toISOString(), positions: {}, orders: [], trades: [], snapshots: [], predictions: [] };
}
export function newState() {
  return { version: 1, createdAt: new Date().toISOString(), fees: FEES, watchlist: ['sh600519', 'sh600036', 'sh600900', 'sh601318', 'sz000333', 'sz000858'], accounts: [newAccount()], analyses: [], quotes: {}, indices: {} };
}
export function feeFor(side, amount, fees = FEES) {
  return round(Math.max(fees.minimum, amount * fees.commission) + amount * fees.transfer + (side === 'SELL' ? amount * fees.stampSell : 0));
}
export function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
export function reservedCash(a) { return round(a.orders.filter(o => o.status === 'pending' && o.side === 'BUY').reduce((s, o) => s + o.reserved, 0)); }
export function availableShares(a, symbol, date) {
  const p = a.positions[symbol];
  const unlocked = p ? p.lots.filter(l => l.date < date).reduce((s, l) => s + l.qty, 0) : 0;
  return unlocked - a.orders.filter(o => o.status === 'pending' && o.side === 'SELL' && o.symbol === symbol).reduce((s, o) => s + o.qty, 0);
}
export function assertQuote(q) {
  if (!q || !Number.isFinite(q.price) || q.price <= 0 || !q.timestamp || !q.name) throw new Error('没有可核验的行情，不能委托。请先刷新行情。');
  if (/ST|退/.test(q.name.toUpperCase())) throw new Error('首版不支持 ST / 退市整理股票。');
}
export function placeOrder(a, input, q, now = new Date()) {
  const symbol = symbolOf(input.symbol); assertQuote(q);
  if (!canTrade(symbol)) throw new Error('该板块当前支持观察和模型分析，模拟交易暂仅开放沪深主板；其他板块需补齐各自申报规则后开放。');
  const side = input.side;
  if (!['BUY', 'SELL'].includes(side)) throw new Error('交易方向无效。');
  const qty = Number(input.qty), limit = Number(input.limit);
  if (!Number.isSafeInteger(qty) || qty <= 0 || qty % 100 !== 0 || qty > 100000000) throw new Error('数量必须是正整数，且为 100 股的整数倍。');
  if (!Number.isFinite(limit) || limit <= 0 || limit > 100000 || Math.abs(limit * 100 - Math.round(limit * 100)) > 0.00001) throw new Error('请输入有效限价，最多两位小数。');
  const b = bjTime(now);
  const quoteDate = q.timestamp.slice(0, 4) + '-' + q.timestamp.slice(4, 6) + '-' + q.timestamp.slice(6, 8);
  const ageDays = (Date.parse(b.date) - Date.parse(quoteDate)) / 86400000;
  if (a.mode === 'live' && (ageDays < 0 || ageDays > 10)) throw new Error('行情日期异常或过旧，暂停委托。');
  const amount = round(limit * qty), reserved = side === 'BUY' ? round(amount + feeFor(side, amount)) : 0;
  if (side === 'BUY' && a.cash - reservedCash(a) + 0.001 < reserved) throw new Error('可用虚拟资金不足（含待成交委托冻结资金及费用）。');
  if (side === 'SELL' && availableShares(a, symbol, b.date) < qty) throw new Error('可卖股数不足。今日买入需下一个交易日才能卖出，待卖委托也会冻结股数。');
  const o = { id: randomUUID(), symbol, name: q.name, side, qty, limit: round(limit), reserved, status: 'pending', createdAt: now.toISOString(), note: '等待有效交易时段与可成交行情', source: String(input.source || 'manual').slice(0, 100) };
  a.orders.push(o); return o;
}
export function matchOrders(a, quotes, now = new Date(), demo = false) {
  const b = bjTime(now);
  for (const o of a.orders.filter(o => o.status === 'pending')) {
    const q = quotes[o.symbol];
    if (!q || !(q.price > 0)) continue;
    if (!demo) {
      if (!tradingTime(now)) { o.note = '非连续竞价时段，委托保留，尚未成交'; continue; }
      const qt = Date.parse(q.timestamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6+08:00'));
      if (!Number.isFinite(qt) || now.getTime() - qt > 120000 || qt - now.getTime() > 5000) { o.note = '行情不够新，暂停撮合'; continue; }
      if (!(q.volume > 0)) { o.note = '无有效成交量，暂停撮合'; continue; }
      if ((o.side === 'BUY' && q.limitUp > 0 && q.price >= q.limitUp - 0.005) || (o.side === 'SELL' && q.limitDown > 0 && q.price <= q.limitDown + 0.005)) { o.note = '涨跌停附近按保守规则不撮合'; continue; }
      if (/ST|退/.test(q.name.toUpperCase())) { o.note = '标的状态改变，暂停撮合'; continue; }
    }
    const price = round(q.price * (o.side === 'BUY' ? 1 + FEES.slippage : 1 - FEES.slippage));
    if ((o.side === 'BUY' && price > o.limit) || (o.side === 'SELL' && price < o.limit)) { o.note = '参考成交价未达到限价'; continue; }
    // Small simulation orders only: cap each fill at 0.1% of observed cumulative volume.
    if (!demo && o.qty > Math.floor(q.volume * 100 * 0.001 / 100) * 100) { o.note = '超出保守成交量上限，等待后续行情'; continue; }
    const amount = round(price * o.qty), fee = feeFor(o.side, amount);
    if (o.side === 'BUY') {
      if (a.cash + 0.001 < amount + fee) { o.note = '虚拟资金不足'; continue; }
      a.cash = round(a.cash - amount - fee);
      const p = a.positions[o.symbol] ||= { symbol: o.symbol, name: o.name, lots: [] };
      p.lots.push({ date: b.date, qty: o.qty, costPerShare: (amount + fee) / o.qty });
    } else {
      const p = a.positions[o.symbol];
      if (!p || p.lots.filter(l => l.date < b.date).reduce((s, l) => s + l.qty, 0) < o.qty) { o.note = 'T+1 可卖数量不足'; continue; }
      let remaining = o.qty;
      for (const lot of p.lots) { if (lot.date >= b.date) continue; const n = Math.min(lot.qty, remaining); lot.qty -= n; remaining -= n; if (!remaining) break; }
      p.lots = p.lots.filter(l => l.qty > 0); if (!p.lots.length) delete a.positions[o.symbol];
      a.cash = round(a.cash + amount - fee);
    }
    o.status = 'filled'; o.filledAt = now.toISOString(); o.fillPrice = price; o.fee = fee; o.note = demo ? '演示行情模拟成交' : '参考行情 + 5bp 滑点的虚拟成交';
    a.trades.push({ id: randomUUID(), orderId: o.id, symbol: o.symbol, name: o.name, side: o.side, qty: o.qty, price, amount, fee, date: b.date, time: now.toISOString(), source: o.source, marketTimestamp: q.timestamp, demo });
  }
}
export function cancelOrder(a, id) {
  const o = a.orders.find(o => o.id === id); if (!o || o.status !== 'pending') throw new Error('委托不存在或已完成。');
  o.status = 'cancelled'; o.note = '已撤销'; o.cancelledAt = new Date().toISOString(); return o;
}
export function valuation(a, quotes, now = new Date()) {
  let marketValue = 0, cost = 0, missing = [];
  const positions = Object.values(a.positions).map(p => {
    const qty = p.lots.reduce((s,l) => s+l.qty,0), basis = p.lots.reduce((s,l)=>s+l.qty*l.costPerShare,0);
    const q = quotes[p.symbol], price = q?.price || basis / qty;
    if (!q?.price) missing.push(p.symbol);
    marketValue += qty * price; cost += basis;
    return { ...p, qty, averageCost: basis / qty, price, marketValue: round(qty * price), profit: round(qty * price - basis), available: availableShares(a,p.symbol,bjTime(now).date), quoteTimestamp: q?.timestamp || null, missingQuote: !q?.price };
  });
  const equity = round(a.cash + marketValue), profit = round(equity - a.initial);
  const prior = a.snapshots.filter(s => s.date < bjTime(now).date).at(-1);
  return { cash: a.cash, availableCash: round(a.cash-reservedCash(a)), reserved: reservedCash(a), marketValue: round(marketValue), equity, profit, returnPct: profit/a.initial*100, dailyProfit: prior ? round(equity-prior.equity) : profit, dailyReturnPct: prior ? (equity/prior.equity-1)*100 : profit/a.initial*100, positions, missing, fees: round(a.trades.reduce((s,t)=>s+t.fee,0)), tradeCount: a.trades.length };
}
export function snapshot(a, quotes, now = new Date()) {
  const v = valuation(a, quotes, now), date = bjTime(now).date;
  if (v.missing.length) return;
  const s = { date, time: now.toISOString(), equity: v.equity, cash:v.cash, returnPct:v.returnPct, provisional:true };
  const i = a.snapshots.findIndex(s=>s.date===date); if(i<0) a.snapshots.push(s); else a.snapshots[i]=s;
}
