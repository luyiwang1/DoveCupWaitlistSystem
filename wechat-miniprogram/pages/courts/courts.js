const db = require('../../utils/db');

Page({
  data: {
    players: [],
    courtCount: 5,
    courtCountInput: 5,
    courts: [],
    captainByCourt: {},
    savedLayout: null,
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
    Promise.all([db.getMain(), db.getCourts()])
      .then(([main, layout]) => {
        const joined = main.state.joined || [];
        const players = joined.filter(p => p && p.name).map((p, i) => ({ key: String(p.id || `${p.name}-${i}`), name: p.name }));
        const courtCount = Number(layout && layout.courtCount) || this.data.courtCount || 5;
        this.setData({ players, savedLayout: layout || null, courtCount, courtCountInput: courtCount }, () => this.applySavedLayout());
      })
      .catch(() => wx.showToast({ title: '同步失败', icon: 'none' }))
      .finally(() => showLoading && wx.hideLoading());
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

  onCourtCountInput(e) { this.setData({ courtCountInput: e.detail.value }); },

  emptyCourts() {
    return Array.from({ length: this.data.courtCount }, () => []);
  },

  applySavedLayout() {
    const players = this.data.players;
    const layout = this.data.savedLayout || {};
    const byKey = new Map(players.map(p => [p.key, p]));
    const used = new Set();
    const courts = this.emptyCourts();
    if (Array.isArray(layout.courts)) {
      layout.courts.slice(0, this.data.courtCount).forEach((court, idx) => {
        if (!Array.isArray(court)) return;
        court.forEach(key => {
          const player = byKey.get(String(key));
          if (player && !used.has(player.key)) {
            courts[idx].push(player);
            used.add(player.key);
          }
        });
      });
    }
    players.forEach(player => {
      if (used.has(player.key)) return;
      let target = 0;
      for (let i = 1; i < courts.length; i++) if (courts[i].length < courts[target].length) target = i;
      courts[target].push(player);
    });
    const captainByCourt = {};
    const savedCaptains = layout.captainByCourt || {};
    courts.forEach((court, idx) => {
      const key = savedCaptains[idx];
      captainByCourt[idx] = court.some(p => p.key === key) ? key : (court[0] ? court[0].key : null);
    });
    this.setData({ courts, captainByCourt });
  },

  shuffle(list) {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  reshuffle() {
    if (!this.data.isAdmin) return;
    const courts = this.emptyCourts();
    this.shuffle(this.data.players).forEach((p, i) => courts[i % courts.length].push(p));
    const captainByCourt = {};
    courts.forEach((court, idx) => {
      if (court.length) captainByCourt[idx] = court[Math.floor(Math.random() * court.length)].key;
    });
    this.setData({ courts, captainByCourt }, () => this.saveLayout());
  },

  randomCaptains() {
    if (!this.data.isAdmin) return;
    const captainByCourt = {};
    this.data.courts.forEach((court, idx) => {
      if (court.length) captainByCourt[idx] = court[Math.floor(Math.random() * court.length)].key;
    });
    this.setData({ captainByCourt }, () => this.saveLayout());
  },

  saveCourtCount() {
    if (!this.data.isAdmin) return;
    const val = parseInt(this.data.courtCountInput, 10);
    if (!Number.isFinite(val) || val < 1 || val > 20) return wx.showToast({ title: '请输入 1-20', icon: 'none' });
    this.setData({ courtCount: val, courtCountInput: val }, () => this.reshuffle());
  },

  saveLayout() {
    const data = {
      courtCount: this.data.courtCount,
      courts: this.data.courts.map(court => court.map(p => p.key)),
      captainByCourt: this.data.captainByCourt
    };
    db.saveCourts(data).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  }
});
