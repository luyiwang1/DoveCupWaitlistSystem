const db = require('../../utils/db');

Page({
  data: {
    state: { title: '金鸽巡回赛', capacity: null, joined: [], waitlist: [] },
    idSeq: 1,
    nameInput: '',
    capacityInput: '',
    isAdmin: false,
    userKey: ''
  },

  onLoad() {
    let userKey = wx.getStorageSync('dove_user_key');
    if (!userKey) {
      userKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      wx.setStorageSync('dove_user_key', userKey);
    }
    this.setData({ userKey, isAdmin: wx.getStorageSync('dove_admin') === '1' });
    this.loadData();
  },

  onShow() {
    this.loadData();
    this.timer = setInterval(() => this.loadData(false), 3000);
  },

  onHide() {
    clearInterval(this.timer);
  },

  loadData(showLoading = true) {
    if (showLoading) wx.showLoading({ title: '同步中' });
    db.getMain()
      .then(main => {
        this.setData({
          state: main.state,
          idSeq: main.idSeq,
          capacityInput: main.state.capacity || ''
        });
      })
      .catch(() => wx.showToast({ title: '同步失败', icon: 'none' }))
      .finally(() => showLoading && wx.hideLoading());
  },

  saveState(nextState, nextIdSeq) {
    const payload = { state: nextState, idSeq: nextIdSeq || this.data.idSeq };
    this.setData({ state: nextState, idSeq: payload.idSeq });
    return db.saveMain(payload).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
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
  onCapacityInput(e) { this.setData({ capacityInput: e.detail.value }); },

  addJoined() { this.addPerson('joined'); },
  addWaitlist() { this.addPerson('waitlist'); },

  addPerson(list) {
    const name = this.data.nameInput.trim();
    if (!name) return wx.showToast({ title: '请输入姓名', icon: 'none' });
    const state = JSON.parse(JSON.stringify(this.data.state));
    let idSeq = this.data.idSeq + 1;
    if (list === 'joined' && state.capacity && state.joined.length >= state.capacity) list = 'waitlist';
    const person = { id: idSeq, name, ownerKey: this.data.userKey, confirmed: false, paid: false, ts: Date.now() };
    if (list === 'joined') state.joined.push(person);
    else state.waitlist.push({ id: person.id, name, ownerKey: person.ownerKey, ts: person.ts });
    this.setData({ nameInput: '' });
    this.saveState(state, idSeq);
  },

  saveCapacity() {
    if (!this.data.isAdmin) return;
    const capacity = parseInt(this.data.capacityInput, 10);
    if (!Number.isFinite(capacity) || capacity < 1) return wx.showToast({ title: '请输入有效名额', icon: 'none' });
    const state = JSON.parse(JSON.stringify(this.data.state));
    state.capacity = capacity;
    if (state.joined.length > capacity) {
      const overflow = state.joined.splice(capacity);
      state.waitlist = overflow.map(p => ({ id: p.id, name: p.name, ownerKey: p.ownerKey, ts: Date.now() })).concat(state.waitlist);
    }
    this.saveState(state);
  },

  findJoined(id) {
    return this.data.state.joined.findIndex(p => String(p.id) === String(id));
  },

  canEdit(person) {
    return this.data.isAdmin || person.ownerKey === this.data.userKey;
  },

  toggleConfirm(e) {
    const state = JSON.parse(JSON.stringify(this.data.state));
    const idx = state.joined.findIndex(p => String(p.id) === String(e.currentTarget.dataset.id));
    if (idx < 0 || !this.canEdit(state.joined[idx])) return;
    state.joined[idx].confirmed = !state.joined[idx].confirmed;
    this.saveState(state);
  },

  togglePaid(e) {
    const state = JSON.parse(JSON.stringify(this.data.state));
    const idx = state.joined.findIndex(p => String(p.id) === String(e.currentTarget.dataset.id));
    if (idx < 0 || !this.canEdit(state.joined[idx])) return;
    state.joined[idx].paid = !state.joined[idx].paid;
    this.saveState(state);
  },

  removeJoined(e) {
    const state = JSON.parse(JSON.stringify(this.data.state));
    const idx = state.joined.findIndex(p => String(p.id) === String(e.currentTarget.dataset.id));
    if (idx < 0 || !this.canEdit(state.joined[idx])) return;
    state.joined.splice(idx, 1);
    if (state.capacity && state.waitlist.length && state.joined.length < state.capacity) {
      const next = state.waitlist.shift();
      state.joined.push({ id: next.id, name: next.name, ownerKey: next.ownerKey, confirmed: false, paid: false, ts: Date.now() });
    }
    this.saveState(state);
  },

  removeWaitlist(e) {
    const state = JSON.parse(JSON.stringify(this.data.state));
    const idx = state.waitlist.findIndex(p => String(p.id) === String(e.currentTarget.dataset.id));
    if (idx < 0 || !this.canEdit(state.waitlist[idx])) return;
    state.waitlist.splice(idx, 1);
    this.saveState(state);
  },

  promoteOne(e) {
    if (!this.data.isAdmin) return;
    const state = JSON.parse(JSON.stringify(this.data.state));
    if (state.capacity && state.joined.length >= state.capacity) return wx.showToast({ title: '名额已满', icon: 'none' });
    const idx = state.waitlist.findIndex(p => String(p.id) === String(e.currentTarget.dataset.id));
    if (idx < 0) return;
    const next = state.waitlist.splice(idx, 1)[0];
    state.joined.push({ id: next.id, name: next.name, ownerKey: next.ownerKey, confirmed: false, paid: false, ts: Date.now() });
    this.saveState(state);
  }
});
