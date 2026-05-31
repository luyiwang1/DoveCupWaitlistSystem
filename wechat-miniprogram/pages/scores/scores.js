const db = require('../../utils/db');

Page({
  data: {
    scores: { players: {}, events: [] },
    signup: { joined: [] },
    players: [],
    topScore: 0,
    nameInput: '',
    winsInput: '1',
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
  },

  loadData(showLoading = true) {
    if (showLoading) wx.showLoading({ title: '同步中' });
    Promise.all([db.getScores(), db.getMain()])
      .then(([scores, main]) => {
        this.setData({ scores, signup: main.state }, () => this.renderPlayers());
      })
      .catch(() => wx.showToast({ title: '同步失败', icon: 'none' }))
      .finally(() => showLoading && wx.hideLoading());
  },

  renderPlayers() {
    const players = Object.values(this.data.scores.players || {})
      .sort((a, b) => (b.points || 0) - (a.points || 0) || (b.wins || 0) - (a.wins || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
    this.setData({ players, topScore: players[0] ? players[0].points || 0 : 0 });
  },

  toggleAdmin() {
    if (this.data.isAdmin) {
      wx.removeStorageSync('dove_admin');
      this.setData({ isAdmin: false });
      return;
    }
    wx.showModal({
      title: '管理员登录',
      editable: true,
      placeholderText: '请输入密码',
      success: (res) => {
        if (res.confirm && res.content === getApp().globalData.adminPassword) {
          wx.setStorageSync('dove_admin', '1');
          this.setData({ isAdmin: true });
        } else if (res.confirm) wx.showToast({ title: '密码错误', icon: 'none' });
      }
    });
  },

  onNameInput(e) { this.setData({ nameInput: e.detail.value }); },
  onWinsInput(e) { this.setData({ winsInput: e.detail.value }); },

  keyForName(name) {
    return name.trim().toLowerCase().replace(/[.#$/[\]]/g, '_');
  },

  ensurePlayer(scores, name) {
    const clean = name.trim();
    if (!clean) return null;
    const key = this.keyForName(clean);
    if (!scores.players[key]) {
      scores.players[key] = { key, name: clean, appearances: 0, manualWins: 0, courtWins: 0, wins: 0, points: 0 };
    }
    return scores.players[key];
  },

  recalc(player) {
    player.manualWins = Number(player.manualWins || 0);
    player.courtWins = Number(player.courtWins || 0);
    player.wins = player.manualWins + player.courtWins;
    player.points = Number(player.appearances || 0) * 50 + player.wins * 10;
  },

  saveScores(scores) {
    this.setData({ scores }, () => this.renderPlayers());
    return db.saveScores(scores).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },

  importCurrentJoined() {
    if (!this.data.isAdmin) return;
    const joined = this.data.signup.joined || [];
    if (!joined.length) return wx.showToast({ title: '报名名单为空', icon: 'none' });
    const scores = JSON.parse(JSON.stringify(this.data.scores));
    joined.forEach(p => {
      const player = this.ensurePlayer(scores, p.name);
      if (!player) return;
      player.appearances += 1;
      this.recalc(player);
      player.lastPlayedAt = Date.now();
    });
    scores.events.unshift({ type: 'participation', count: joined.length, ts: Date.now() });
    scores.events = scores.events.slice(0, 20);
    this.saveScores(scores);
  },

  addParticipation() {
    if (!this.data.isAdmin) return;
    const scores = JSON.parse(JSON.stringify(this.data.scores));
    const player = this.ensurePlayer(scores, this.data.nameInput);
    if (!player) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    player.appearances += 1;
    this.recalc(player);
    player.lastPlayedAt = Date.now();
    scores.events.unshift({ type: 'manualParticipation', name: player.name, ts: Date.now() });
    scores.events = scores.events.slice(0, 20);
    this.saveScores(scores);
  },

  addWins() {
    if (!this.data.isAdmin) return;
    const wins = parseInt(this.data.winsInput, 10);
    if (!Number.isFinite(wins) || wins < 0) return wx.showToast({ title: '请输入赢局数', icon: 'none' });
    const scores = JSON.parse(JSON.stringify(this.data.scores));
    const player = this.ensurePlayer(scores, this.data.nameInput);
    if (!player) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    player.manualWins = Number(player.manualWins || 0) + wins;
    this.recalc(player);
    scores.events.unshift({ type: 'wins', name: player.name, wins, ts: Date.now() });
    scores.events = scores.events.slice(0, 20);
    this.saveScores(scores);
  },

  resetPlayer() {
    if (!this.data.isAdmin) return;
    const name = this.data.nameInput.trim();
    if (!name) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    const scores = JSON.parse(JSON.stringify(this.data.scores));
    const key = this.keyForName(name);
    if (!scores.players[key]) return wx.showToast({ title: '找不到此人', icon: 'none' });
    wx.showModal({
      title: '重置此人积分',
      content: `确定重置 ${scores.players[key].name} 吗？`,
      success: (res) => {
        if (!res.confirm) return;
        delete scores.players[key];
        scores.events.unshift({ type: 'resetPlayer', name, ts: Date.now() });
        scores.events = scores.events.slice(0, 20);
        this.saveScores(scores);
      }
    });
  },

  resetAllScores() {
    if (!this.data.isAdmin) return;
    wx.showModal({
      title: '重置全部积分',
      content: '确定清空所有积分记录吗？',
      success: (res) => {
        if (!res.confirm) return;
        this.saveScores({ players: {}, events: [{ type: 'resetAll', ts: Date.now() }] });
      }
    });
  }
});
