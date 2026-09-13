/**
 * 骰子工具：使用 Web Crypto 生成无偏随机数（比 Math.random 更适合跑团场景）。
 */

function randInt(maxExclusive) {
  if (maxExclusive <= 0) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xFFFFFFFF / maxExclusive) * maxExclusive;
  // 拒绝采样，消除取模偏差
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
}

/** 掷 n 个 d 面骰，返回明细与合计 */
export function roll(n, d) {
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(randInt(d) + 1);
  return { rolls, total: rolls.reduce((a, b) => a + b, 0), detail: `${n}D${d}=[${rolls.join('+')}]` };
}

/** 3d6×5：力量/体质/敏捷/外貌/意志 的标准生成法 */
export function roll3d6x5() {
  const r = roll(3, 6);
  return { value: r.total * 5, detail: r.detail };
}

/** (2d6+6)×5：体型/智力/教育 的标准生成法 */
export function roll2d6p6x5() {
  const r = roll(2, 6);
  return { value: (r.total + 6) * 5, detail: `${r.detail}+6` };
}

/** 幸运：默认掷一次 3D6×5；15-19 岁按规则可掷两次取高 */
export function rollLuck(twice = false) {
  const a = roll(3, 6);
  if (!twice) return { value: a.total * 5, detail: a.detail };
  const b = roll(3, 6);
  const best = Math.max(a.total, b.total);
  return { value: best * 5, detail: `${a.detail} / ${b.detail} 取高` };
}

/** d100 检定（含奖励/惩罚骰） */
export function checkD100(target, { bonus = 0, penalty = 0 } = {}) {
  const tens = () => randInt(10);
  const ones = randInt(10);
  const rolls = [tens() * 10 + ones];
  const extra = Math.abs(bonus - penalty);
  for (let i = 0; i < extra; i++) rolls.push(tens() * 10 + ones);
  const pick = bonus > penalty ? Math.min(...rolls) : penalty > bonus ? Math.max(...rolls) : rolls[0];
  const value = pick === 0 ? 100 : pick;
  const level = value === 1 ? '大成功'
    : value <= Math.floor(target / 5) ? '极难成功'
      : value <= Math.floor(target / 2) ? '困难成功'
        : value <= target ? '成功'
          : (value >= 96 && target < 50) || value === 100 ? '大失败' : '失败';
  return { value, level, rolls };
}

/** 一次生成八项属性（不含幸运），并给出掷骰明细 */
export function rollCharacteristics() {
  const out = {};
  const detail = {};
  for (const k of ['STR', 'CON', 'DEX', 'APP', 'POW']) {
    const r = roll3d6x5();
    out[k] = r.value;
    detail[k] = `3D6×5 ${r.detail}`;
  }
  for (const k of ['SIZ', 'INT', 'EDU']) {
    const r = roll2d6p6x5();
    out[k] = r.value;
    detail[k] = `(2D6+6)×5 ${r.detail}`;
  }
  return { chars: out, detail };
}

/** 教育增强检定：d100 > 当前教育则 +1D10 */
export function educationCheck(currentEdu) {
  const r = roll(1, 100);
  const gain = r.total > currentEdu ? roll(1, 10).total : 0;
  return { roll: r.total, gain, detail: `D100=${r.total} vs 教育 ${currentEdu} → ${gain ? `+${gain}` : '无提升'}` };
}
