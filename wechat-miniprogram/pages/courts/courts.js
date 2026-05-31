const db = require('../../utils/db');

Page({
  data: {
    players: [],
    courtCount: 5,
    courtCountInput: 5,
    baseCourts: [],
    rounds: [],
    roundScores: {},
    isAdmin: false
  },

  onLoad() {
    this.setData({ isAdmin: wx.getStorageSync('dove_admin') === '1' });
    this.loadData();
  },

  onShow() {
    this.loadData(false);
    this.timer = setInterval(() => this.loadData(false), 4000);
  },

  onHide() {
    clearInterval(this.timer);
    clearTimeout(this.scoreTimer);
  },

  loadData(showLoading = true) {
    if (showLoading) wx.showLoading({ title: '同步中' });
    Promise.all([db.getMain(), db.getCourts()])
      .then(([main, layout]) => {
        const joined = main.state.joined || [];
        const players = joined
          .filter(p => p && p.name)
          .map((p, i) => ({ key: String(p.id || `${p.name}-${i}`), name: p.name }));
        const courtCount = Number(layout && layout.courtCount) || this.data.courtCount || 5;
        const roundScores = layout && layout.roundScores && typeof layout.roundScores === 'object' ? layout.roundScores : {};
        this.setData({ players, courtCount, courtCountInput: courtCount, roundScores }, () => {
          this.applySavedLayout(layout || {});
        });
      })
      .catch(() => wx.showToast({ title: '同步失败', icon: 'none' }))
      .finally(() => showLoading && wx.hideLoading());
  },

  toggleAdmin() {
    if (this.data.isAdmin) {
      wx.removeStorageSync('dove_admin');
      this.setData({ isAdmin: false }, () => this.buildRounds());
      return;
    }
    wx.showModal({
      title: '管理员登录',
      editable: true,
      placeholderText: '请输入密码',
      success: (res) => {
        if (res.confirm && res.content === getApp().globalData.adminPassword) {
          wx.setStorageSync('dove_admin', '1');
          this.setData({ isAdmin: true }, () => this.buildRounds());
        } else if (res.confirm) wx.showToast({ title: '密码错误', icon: 'none' });
      }
    });
  },

  onCourtCountInput(e) { this.setData({ courtCountInput: e.detail.value }); },

  emptyCourts() {
    return Array.from({ length: this.data.courtCount }, () => []);
  },

  applySavedLayout(layout) {
    const byKey = new Map(this.data.players.map(p => [p.key, p]));
    const used = new Set();
    const baseCourts = this.emptyCourts();
    if (Array.isArray(layout.courts)) {
      layout.courts.slice(0, this.data.courtCount).forEach((court, idx) => {
        if (!Array.isArray(court)) return;
        court.forEach(key => {
          const player = byKey.get(String(key));
          if (player && !used.has(player.key)) {
            baseCourts[idx].push(player);
            used.add(player.key);
          }
        });
      });
    }
    this.data.players.forEach(player => {
      if (used.has(player.key)) return;
      let target = 0;
      for (let i = 1; i < baseCourts.length; i++) if (baseCourts[i].length < baseCourts[target].length) target = i;
      baseCourts[target].push(player);
    });
    this.setData({ baseCourts }, () => this.buildRounds());
  },

  shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  splitInitialCourts(list) {
    const courts = this.emptyCourts();
    list.forEach((p, i) => courts[i % courts.length].push(p));
    return courts;
  },

  makeMatch(list, courtIndex, roundIndex) {
    const teamA = [];
    const teamB = [];
    list.filter(Boolean).forEach((p, i) => {
      if (list.length >= 4) (i === 0 || i === 3 ? teamA : teamB).push(p);
      else (i % 2 === 0 ? teamA : teamB).push(p);
    });
    const score = this.data.roundScores[`${roundIndex}-${courtIndex}`] || {};
    const scored = score.a !== '' && score.b !== '' && Number.isFinite(Number(score.a)) && Number.isFinite(Number(score.b));
    const aWin = scored && Number(score.a) >= Number(score.b);
    const bWin = scored && Number(score.b) > Number(score.a);
    return {
      courtIndex,
      courtName: `Court ${courtIndex + 1}`,
      teamA,
      teamB,
      scoreA: score.a === undefined ? '' : score.a,
      scoreB: score.b === undefined ? '' : score.b,
      aWin,
      bWin,
      moveText: `胜→Court ${Math.max(1, courtIndex)} / 负→Court ${Math.min(this.data.courtCount, courtIndex + 2)}`
    };
  },

  addSplitPair(bucket, team) {
    team.forEach((p, i) => bucket[i % 2 === 0 ? 'a' : 'b'].push(p));
  },

  buildRounds() {
    const rounds = [];
    let current = this.data.baseCourts.map((court, idx) => this.makeMatch(court, idx, 0));
    for (let r = 0; r < 3; r++) {
      rounds.push({ title: `第 ${r + 1} 轮`, matches: current });
      if (r === 2) break;
      const buckets = Array.from({ length: this.data.courtCount }, () => ({ a: [], b: [] }));
      current.forEach((match, idx) => {
        let win = match.teamA;
        let lose = match.teamB;
        if (match.bWin) {
          win = match.teamB;
          lose = match.teamA;
        }
        this.addSplitPair(buckets[Math.max(0, idx - 1)], win);
        this.addSplitPair(buckets[Math.min(this.data.courtCount - 1, idx + 1)], lose);
      });
      current = buckets.map((bucket, idx) => this.makeMatch(bucket.a.concat(bucket.b), idx, r + 1));
      current = buckets.map((bucket, idx) => {
        const match = this.makeMatch([], idx, r + 1);
        match.teamA = bucket.a;
        match.teamB = bucket.b;
        return match;
      });
    }
    this.setData({ rounds });
  },

  reshuffle() {
    if (!this.data.isAdmin) return;
    const baseCourts = this.splitInitialCourts(this.shuffle(this.data.players));
    this.setData({ baseCourts, roundScores: {} }, () => {
      this.buildRounds();
      this.saveLayout();
      this.scheduleScoreSync();
    });
  },

  saveCourtCount() {
    if (!this.data.isAdmin) return;
    const val = parseInt(this.data.courtCountInput, 10);
    if (!Number.isFinite(val) || val < 1 || val > 20) return wx.showToast({ title: '请输入 1-20', icon: 'none' });
    this.setData({ courtCount: val, courtCountInput: val }, () => this.reshuffle());
  },

  clearScores() {
    if (!this.data.isAdmin) return;
    wx.showModal({
      title: '清空比分',
      content: '确定清空三轮比分吗？积分榜里的场地比分也会归零。',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ roundScores: {} }, () => {
          this.buildRounds();
          this.saveLayout();
          this.scheduleScoreSync();
        });
      }
    });
  },

  onScoreInput(e) {
    if (!this.data.isAdmin) return;
    const { round, court, side } = e.currentTarget.dataset;
    const key = `${round}-${court}`;
    const roundScores = JSON.parse(JSON.stringify(this.data.roundScores));
    roundScores[key] = roundScores[key] || {};
    roundScores[key][side] = e.detail.value === '' ? '' : Number(e.detail.value);
    this.setData({ roundScores }, () => {
      this.buildRounds();
      this.saveLayout();
      this.scheduleScoreSync();
    });
  },

  saveLayout() {
    const data = {
      courtCount: this.data.courtCount,
      courts: this.data.baseCourts.map(court => court.map(p => p.key)),
      roundScores: this.data.roundScores
    };
    db.saveCourts(data).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },

  scheduleScoreSync() {
    clearTimeout(this.scoreTimer);
    this.scoreTimer = setTimeout(() => this.syncScores(true), 600);
  },

  computeCourtWins() {
    const totals = {};
    this.data.rounds.forEach((round, rIdx) => {
      round.matches.forEach((match, cIdx) => {
        const score = this.data.roundScores[`${rIdx}-${cIdx}`] || {};
        if (!Number.isFinite(Number(score.a)) || !Number.isFinite(Number(score.b))) return;
        match.teamA.forEach(p => { totals[p.key] = (totals[p.key] || 0) + Number(score.a); });
        match.teamB.forEach(p => { totals[p.key] = (totals[p.key] || 0) + Number(score.b); });
      });
    });
    return totals;
  },

  keyForName(name) {
    return name.trim().toLowerCase().replace(/[.#$/[\]]/g, '_');
  },

  syncScores(silent = false) {
    if (!this.data.isAdmin && !silent) return;
    Promise.resolve(db.getScores()).then(scores => {
      const wins = this.computeCourtWins();
      this.data.players.forEach(p => {
        const key = this.keyForName(p.name);
        const existing = scores.players[key] || { key, name: p.name, appearances: 0, wins: 0, points: 0 };
        const manualWins = Number(existing.manualWins !== undefined ? existing.manualWins : (Number(existing.wins || 0) - Number(existing.courtWins || 0))) || 0;
        existing.name = p.name;
        existing.manualWins = manualWins;
        existing.courtWins = Number(wins[p.key] || 0);
        existing.wins = existing.manualWins + existing.courtWins;
        existing.points = Number(existing.appearances || 0) * 50 + existing.wins * 10;
        scores.players[key] = existing;
      });
      scores.events.unshift({ type: 'courtScores', ts: Date.now() });
      scores.events = scores.events.slice(0, 20);
      return db.saveScores(scores);
    }).then(() => {
      if (!silent) wx.showToast({ title: '已同步积分' });
    }).catch(() => wx.showToast({ title: '同步失败', icon: 'none' }));
  }
});
