// 设置页逻辑（WebUI 版：嵌套结构 + ASR 配置；无 ollama）

const PROVIDER_CONFIG = {
  openai: {
    needsKey: true,
    keyHint: '在 platform.openai.com 获取',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' }
    ]
  },
  deepseek: {
    needsKey: true,
    keyHint: '在 platform.deepseek.com 获取',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat（推荐）' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder' }
    ]
  },
  custom: {
    needsKey: true,
    keyHint: '自定义 API Key',
    models: []
  }
};

class SettingsPage {
  constructor() {
    this.providerSelect = document.getElementById('provider');
    this.apikeyInput = document.getElementById('apikey');
    this.apikeyHint = document.getElementById('apikey-hint');
    this.modelSelect = document.getElementById('model');
    this.customBaseUrlInput = document.getElementById('custom-base-url');
    this.customModelInput = document.getElementById('custom-model');
    this.asrProviderSelect = document.getElementById('asr-provider');
    this.asrWsUrlInput = document.getElementById('asr-wsurl');
    this.asrTokenInput = document.getElementById('asr-token');
    this.asrWsUrlLabel = document.getElementById('asr-wsurl-label');
    this.asrTokenLabel = document.getElementById('asr-token-label');
    this.asrWsUrlHint = document.getElementById('asr-wsurl-hint');
    // 各 provider 槽位：切换时保留各自已加载/编辑的值，不互相写入（审查 P0-3/P1-4）
    this.asrSlot = { funasr: { wsUrl: '', token: '' }, 'funasr-v2': { wsUrl: '', token: '' } };
    this.feedbackThresholdInput = document.getElementById('feedback-threshold');
    this.btnSave = document.getElementById('btn-save');
    this.saveSuccess = document.getElementById('save-success');

    this.groupApikey = document.getElementById('group-apikey');
    this.groupCustom = document.getElementById('group-custom');
    this.groupCustomModel = document.getElementById('group-custom-model');

    this.bindEvents();
    this.loadSettings();
  }

  bindEvents() {
    this.providerSelect.addEventListener('change', () => this.onProviderChange());
    this.asrProviderSelect.addEventListener('change', () => this.onAsrProviderChange());
    this.btnSave.addEventListener('click', () => this.save());
  }

  async loadSettings() {
    this.settings = await window.api.getSettings();
    if (!this.settings) { this.settings = { llm: { provider: 'deepseek', providers: {} }, asr: { provider: 'funasr', funasr: {} }, feedback: {} }; }
    const llm = this.settings.llm || {};
    const asr = this.settings.asr || {};
    const fb = this.settings.feedback || {};

    this.providerSelect.value = llm.provider || 'deepseek';
    this.asrProviderSelect.value = asr.provider || 'funasr';
    // 按当前 provider 读对应块；两块均预存槽位，切换时不串扰
    const curProvider = this.asrProviderSelect.value;
    this.asrSlot['funasr'] = { wsUrl: (asr.funasr && asr.funasr.wsUrl) || '', token: (asr.funasr && asr.funasr.token) || '' };
    this.asrSlot['funasr-v2'] = { wsUrl: (asr.funasrV2 && asr.funasrV2.wsUrl) || '', token: (asr.funasrV2 && asr.funasrV2.token) || '' };
    this.asrWsUrlInput.value = curProvider === 'funasr-v2' ? this.asrSlot['funasr-v2'].wsUrl : this.asrSlot['funasr'].wsUrl;
    this.asrTokenInput.value = this.asrSlot[curProvider] ? this.asrSlot[curProvider].token : '';
    this.feedbackThresholdInput.value = fb.autoThresholdChars || 50;

    this.onProviderChange();
    this.updateAsrLabels(curProvider);
  }

  // ASR provider 切换：当前输入框值存回旧槽 → 读新槽值 → 更新 label/hint（不清空、不互相写入）
  onAsrProviderChange() {
    const oldProvider = this.asrProviderSelect.value === 'funasr-v2' ? 'funasr' : 'funasr-v2';
    this.asrSlot[oldProvider] = { wsUrl: this.asrWsUrlInput.value, token: this.asrTokenInput.value };
    const cur = this.asrProviderSelect.value;
    const slot = this.asrSlot[cur] || { wsUrl: '', token: '' };
    this.asrWsUrlInput.value = slot.wsUrl || '';
    this.asrTokenInput.value = slot.token || '';
    this.updateAsrLabels(cur);
  }

  updateAsrLabels(provider) {
    const isV2 = provider === 'funasr-v2';
    this.asrWsUrlLabel.textContent = isV2 ? 'FunASR v2 WebSocket 地址' : 'FunASR WebSocket 地址';
    this.asrTokenLabel.textContent = isV2 ? 'FunASR v2 Token（可选）' : 'FunASR Token（可选）';
    this.asrWsUrlHint.textContent = isV2 ? '新版实时服务地址（示例 ws://192.168.156.68:10095）' : '服务器上部署的 FunASR 服务地址（待配置）';
  }

  loadProviderFields(provider) {
    const p = (this.settings.llm && this.settings.llm.providers && this.settings.llm.providers[provider]) || {};
    this.apikeyInput.value = p.apiKey || '';
    this.customBaseUrlInput.value = p.baseUrl || '';
    this.customModelInput.value = p.customModel || '';
    if (p.model) this.modelSelect.value = p.model;
  }

  onProviderChange() {
    const provider = this.providerSelect.value;
    const config = PROVIDER_CONFIG[provider];

    this.groupApikey.classList.toggle('visible', !!config.needsKey);
    this.groupCustom.classList.toggle('visible', provider === 'custom');
    this.groupCustomModel.classList.toggle('visible', provider === 'custom');

    if (config.keyHint) this.apikeyHint.textContent = config.keyHint;

    this.modelSelect.innerHTML = '';
    if (config.models.length > 0) {
      config.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        this.modelSelect.appendChild(opt);
      });
      this.modelSelect.parentElement.style.display = '';
    } else {
      this.modelSelect.parentElement.style.display = 'none';
    }

    this.loadProviderFields(provider);
  }

  async save() {
    const provider = this.providerSelect.value;
    const errorEl = document.getElementById('connection-error');
    errorEl.classList.remove('show');
    errorEl.textContent = '';

    // 从后端拿当前设置（含未脱敏 key 由后端合并），构建嵌套结构
    const settings = await window.api.getSettings();
    const llm = settings.llm || { provider: 'deepseek', providers: {} };
    const providers = llm.providers || {};

    if (provider === 'custom') {
      providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.customModelInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: this.customModelInput.value.trim()
      };
    } else {
      providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.modelSelect.value || 'deepseek-chat',
        baseUrl: '',
        customModel: ''
      };
    }

    // ASR payload 只提交当前 provider 对应的块（审查 P0-3）：配合服务端"未提交块保留"逻辑闭环，
    // 防止 funasr ↔ funasrV2 互切时误把 A 的地址存进 B
    const asrProvider = this.asrProviderSelect.value;
    const asrBlock = asrProvider === 'funasr-v2'
      ? { funasrV2: { wsUrl: this.asrWsUrlInput.value.trim(), token: this.asrTokenInput.value.trim() } }
      : { funasr: { wsUrl: this.asrWsUrlInput.value.trim(), token: this.asrTokenInput.value.trim() } };

    const payload = {
      llm: { provider, providers },
      asr: { provider: asrProvider, ...asrBlock },
      feedback: {
        autoThresholdChars: parseInt(this.feedbackThresholdInput.value, 10) || 50
      }
    };

    try {
      await window.api.saveSettings(payload);
      this.settings = await window.api.getSettings();

      this.btnSave.textContent = '保存设置';
      this.saveSuccess.classList.add('show');
      setTimeout(() => {
        this.saveSuccess.classList.remove('show');
      }, 1500);
    } catch (e) {
      this.btnSave.textContent = '保存设置';
      errorEl.textContent = `⚠️ 保存失败: ${e.message}`;
      errorEl.classList.add('show');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsPage();
});