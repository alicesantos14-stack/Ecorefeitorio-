const STORAGE_KEY = 'ecorefeitorio-data-v1';
const SESSION_KEY = 'ecorefeitorio-session-v1';
const DEFAULT_MENU = { title: 'Almoço do dia', main: '', side: '', salad: '', dessert: '' };
const DEFAULT_DATA = { yes: 0, no: 0, repeat: 0, small: 0, medium: 0, pin: '1234', settings: { appName: 'Ecorefeitório', brandCaption: 'CONECTA CAIÇARA · GRUPO 2', loginDomain: 'escola.pr.gov.br', votingCutoff: '10:45', plateGrams: 350, riceGrams: 130, beansGrams: 80, meatGrams: 120, plateDisplaySeconds: 15, repeatMessage: 'Porção extra confirmada. Bom apetite!', yesMessage: 'Resposta “Vou comer” registrada.', noMessage: 'Resposta “Não vou comer” registrada.', portionMessage: 'Porção {portion} confirmada. Bom apetite!', creamColor: '#F9F8F3', forestColor: '#1E4C38', greenColor: '#34A853' }, wasteHistory: {}, dailyHistory: {}, queue: [], queueNextAt: null, menu: { ...DEFAULT_MENU }, weeklyMenus: {} };
let queueTimer;
let portionClickLocked = false;

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function yesterdayKey() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return dateKey(yesterday);
}

function saveDailyHistory(day = data.date || dateKey()) {
  const previous = data.dailyHistory[day] || {};
  data.dailyHistory[day] = {
    wasteKg: Number(data.wasteHistory[day] ?? previous.wasteKg ?? 0),
    wasteReported: Boolean(previous.wasteReported || Object.prototype.hasOwnProperty.call(data.wasteHistory, day)),
    meals: Math.max(Number(previous.meals || 0), Number(data.small || 0) + Number(data.medium || 0))
  };
}

function getVotingCutoffMinutes() {
  const cutoff = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(data.settings.votingCutoff || ''));
  return cutoff ? Number(cutoff[1]) * 60 + Number(cutoff[2]) : 10 * 60 + 45;
}

function isVotingClosed(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes() >= getVotingCutoffMinutes();
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if ('developerPassword' in saved || 'loginHistory' in saved || 'votersByDate' in saved) {
      delete saved.developerPassword;
      delete saved.loginHistory;
      delete saved.votersByDate;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
    const weeklyMenus = saved.weeklyMenus && typeof saved.weeklyMenus === 'object' && !Array.isArray(saved.weeklyMenus)
      ? { ...saved.weeklyMenus } : {};
    const today = String(new Date().getDay());
    if (!weeklyMenus[today] && saved.menu && (saved.menu.main || saved.menu.side || saved.menu.salad || saved.menu.dessert)) {
      weeklyMenus[today] = { ...DEFAULT_MENU, ...saved.menu };
    }
    return {
      ...DEFAULT_DATA,
      ...saved,
      settings: { ...DEFAULT_DATA.settings, ...(saved.settings || {}) },
      wasteHistory: saved.wasteHistory && typeof saved.wasteHistory === 'object' ? saved.wasteHistory : {},
      dailyHistory: saved.dailyHistory && typeof saved.dailyHistory === 'object' ? saved.dailyHistory : {},
      repeat: Number.isFinite(saved.repeat) ? saved.repeat : 0,
      menu: { ...DEFAULT_MENU, ...(saved.menu || {}) },
      weeklyMenus,
      queue: Array.isArray(saved.queue) ? saved.queue.filter((type) => type === 'small' || type === 'medium') : []
    };
  } catch {
    return { ...DEFAULT_DATA, weeklyMenus: {} };
  }
}

let data = loadData();
let loggedIn = false;
let activePage = 'filaPage';

const $ = (id) => document.getElementById(id);
const pages = ['filaPage', 'totemPage', 'kitchenPage', 'servedPage', 'settingsPage'];

function saveData() {
  if (!data.dailyHistory || typeof data.dailyHistory !== 'object') data.dailyHistory = {};
  saveDailyHistory();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function plateDisplayMs() {
  const seconds = Number(data.settings.plateDisplaySeconds);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 15) * 1000;
}

function formatKgValue(value) {
  return `${Number(value || 0).toFixed(2).replace('.', ',')} kg`;
}

function updateTotemAvailability() {
  const closed = isVotingClosed();
  $('totemVotingArea').classList.toggle('hidden', closed);
  $('totemClosedNotice').classList.toggle('hidden', !closed);
  $('totemTitle').innerHTML = closed ? 'Atendimento<br />encerrado' : 'Qual será<br />a sua porção?';
  $('totemSubtitle').textContent = closed
    ? 'Consulte os pratos que já foram registrados hoje.'
    : 'Escolha uma opção para registrar seu prato.';
  $('totemClosedNotice').querySelector('span').textContent = `O registro de novas refeições fica disponível até as ${data.settings.votingCutoff || '10:45'}. Esta tela está em modo de visualização.`;
  document.querySelectorAll('.portion-card').forEach((button) => {
    button.disabled = closed || portionClickLocked;
  });
}

function renderHistoryReport() {
  const now = new Date();
  const today = dateKey(now);
  const week = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = dateKey(day);
    const stored = data.dailyHistory[key] || {};
    week.push({
      key,
      date: day,
      wasteKg: Number(data.wasteHistory[key] ?? stored.wasteKg ?? 0),
      wasteReported: Boolean(stored.wasteReported || Object.prototype.hasOwnProperty.call(data.wasteHistory, key)),
      meals: Math.max(Number(stored.meals || 0), key === today ? data.small + data.medium : 0)
    });
  }

  const monthPrefix = today.slice(0, 7);
  const monthDays = new Set([
    ...Object.keys(data.dailyHistory),
    ...Object.keys(data.wasteHistory),
    today
  ].filter((key) => key.startsWith(monthPrefix)));
  let monthlyWaste = 0;
  let monthlyMeals = 0;
  monthDays.forEach((key) => {
    const stored = data.dailyHistory[key] || {};
    monthlyWaste += Number(data.wasteHistory[key] ?? stored.wasteKg ?? 0);
    monthlyMeals += Math.max(Number(stored.meals || 0), key === today ? data.small + data.medium : 0);
  });
  $('monthlyWaste').textContent = formatKgValue(monthlyWaste);
  $('monthlyMeals').textContent = String(monthlyMeals);

  const reportedWasteDays = week.filter((item) => item.wasteReported);
  let trend = 'Registre o desperdício';
  if (reportedWasteDays.length >= 2) {
    const first = reportedWasteDays[0].wasteKg;
    const last = reportedWasteDays[reportedWasteDays.length - 1].wasteKg;
    if (first > 0) {
      const change = Math.round(((last - first) / first) * 100);
      trend = change < 0 ? `Redução de ${Math.abs(change)}%` : change > 0 ? `Aumento de ${change}%` : 'Sem variação';
    } else {
      trend = last === 0 ? 'Sem variação' : 'Aumento';
    }
  } else if (reportedWasteDays.length === 1) {
    trend = '1 dia registrado';
  }
  $('weeklyWasteTrend').textContent = trend;

  const maxWaste = Math.max(...week.map((item) => item.wasteKg), 0.01);
  const chart = $('weeklyChart');
  chart.replaceChildren(...week.map((item) => {
    const column = document.createElement('div');
    column.className = 'chart-column';
    const value = document.createElement('span');
    value.className = 'chart-value';
    value.textContent = `${item.wasteKg.toFixed(2).replace('.', ',')} kg`;
    const track = document.createElement('div');
    track.className = 'chart-bar-track';
    const bar = document.createElement('span');
    bar.className = 'chart-bar';
    bar.style.height = `${item.wasteKg ? Math.max(5, (item.wasteKg / maxWaste) * 100) : 0}%`;
    track.append(bar);
    const label = document.createElement('small');
    label.textContent = item.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    column.append(value, track, label);
    return column;
  }));

  const rows = [...week].reverse().map((item) => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = item.date.toLocaleDateString('pt-BR');
    const wasteCell = document.createElement('td');
    wasteCell.textContent = formatKgValue(item.wasteKg);
    const mealsCell = document.createElement('td');
    mealsCell.textContent = String(item.meals);
    row.append(dateCell, wasteCell, mealsCell);
    return row;
  });
  $('historyTableBody').replaceChildren(...rows);
}

function applyGlobalSettings() {
  const settings = data.settings;
  document.title = `${settings.appName} · Conecta Caiçara`;
  document.querySelectorAll('.brand-name').forEach((element) => { element.textContent = settings.appName; });
  document.querySelectorAll('.brand-caption').forEach((element) => { element.textContent = settings.brandCaption; });
  const root = document.documentElement;
  root.style.setProperty('--cream', settings.creamColor);
  root.style.setProperty('--forest', settings.forestColor);
  root.style.setProperty('--green', settings.greenColor);
}

function rollOverDay() {
  const today = dateKey();
  if (!data.date) {
    data.date = today;
    saveData();
  } else if (data.date !== today) {
    saveDailyHistory(data.date);
    data.previousDay = {
      date: data.date,
      yes: data.yes,
      no: data.no,
      repeat: data.repeat,
      small: data.small,
      medium: data.medium,
      wasteKg: Number(data.wasteHistory[data.date] || 0)
    };
    data.date = today;
    data.yes = 0;
    data.no = 0;
    data.repeat = 0;
    data.small = 0;
    data.medium = 0;
    data.queue = [];
    data.queueNextAt = null;
    saveData();
    $('menuDayInput').value = String(new Date().getDay());
    setMenuFormValues($('menuDayInput').value);
    $('responseNotice').textContent = '';
    $('totemNotice').textContent = '';
  }
}

function formatKg(portions, gramsPerPortion) {
  return ((portions * gramsPerPortion) / 1000).toFixed(3).replace('.', ',');
}

function updateDisplay() {
  applyGlobalSettings();
  rollOverDay();
  updateTotemAvailability();
  clearTimeout(queueTimer);
  if (data.queue.length) {
    const now = Date.now();
    if (!Number.isFinite(data.queueNextAt)) {
      data.queueNextAt = now + plateDisplayMs();
      saveData();
    } else if (now >= data.queueNextAt) {
      const delay = plateDisplayMs();
      const elapsed = Math.floor((now - data.queueNextAt) / delay) + 1;
      data.queue.splice(0, elapsed);
      data.queueNextAt = data.queue.length ? data.queueNextAt + elapsed * delay : null;
      saveData();
    }
    if (data.queue.length) {
      queueTimer = setTimeout(() => {
        data = loadData();
        updateDisplay();
      }, Math.max(0, data.queueNextAt - Date.now()));
    }
  }
  const total = data.yes + data.no;
  const served = data.small + data.medium;
  const yesterday = data.previousDay && data.previousDay.date === yesterdayKey()
    ? data.previousDay : null;
  let recommended = data.yes;
  const yesterdayServed = yesterday ? yesterday.small + yesterday.medium : 0;
  if (yesterday && yesterday.yes > 0 && yesterdayServed > 0) {
    const rate = Math.min(1, Math.max(0.8, yesterdayServed / yesterday.yes));
    recommended = Math.ceil(data.yes * rate);
  }
  const servingsToPrepare = recommended + data.repeat;
  const plateScale = Number(data.settings.plateGrams) / 350;
  $('yesterdayWaste').textContent = formatKgValue(data.wasteHistory[yesterdayKey()] || 0);
  if (document.activeElement !== $('wasteInput')) $('wasteInput').value = data.wasteHistory[dateKey()] ?? '';
  $('queueWaitText').textContent = `Cada pedido aparece por ${data.settings.plateDisplaySeconds} segundos antes de passar automaticamente para o próximo.`;
  $('totalCount').textContent = total;
  $('yesCount').textContent = data.yes;
  $('noCount').textContent = data.no;
  const yesPercentage = total ? Math.round((data.yes / total) * 100) : 0;
  $('responsePercent').textContent = `${yesPercentage}%`;
  $('responseProgress').style.width = `${yesPercentage}%`;
  const ricePerServing = Number(data.settings.riceGrams) * plateScale;
  const beansPerServing = Number(data.settings.beansGrams) * plateScale;
  const meatPerServing = Number(data.settings.meatGrams) * plateScale;
  $('riceAmount').innerHTML = `${formatKg(servingsToPrepare, ricePerServing)} <small>kg</small>`;
  $('beansAmount').innerHTML = `${formatKg(servingsToPrepare, beansPerServing)} <small>kg</small>`;
  $('meatAmount').innerHTML = `${formatKg(servingsToPrepare, meatPerServing)} <small>kg</small>`;
  $('riceRecipe').textContent = `${Math.round(ricePerServing)} g por porção`;
  $('beansRecipe').textContent = `${Math.round(beansPerServing)} g por porção`;
  $('meatRecipe').textContent = `${Math.round(meatPerServing)} g por porção`;
  $('smallCount').textContent = data.small;
  $('mediumCount').textContent = data.medium;
  $('servedTotal').textContent = served;
  $('kitchenServedTotal').textContent = served;
  const today = new Date();
  const todayMenu = data.weeklyMenus[String(today.getDay())] || DEFAULT_MENU;
  $('filaMenuDay').textContent = today.toLocaleDateString('pt-BR', { weekday: 'long' });
  $('filaMenuTitle').textContent = todayMenu.title || DEFAULT_MENU.title;
  $('filaMenuMain').textContent = todayMenu.main || 'Cardápio ainda não cadastrado para hoje';
  $('filaMenuSide').textContent = todayMenu.side || '—';
  $('filaMenuSalad').textContent = todayMenu.salad || '—';
  $('filaMenuDessert').textContent = todayMenu.dessert || '—';

  const nextPlate = data.queue[0];
  $('nextPlateTitle').textContent = nextPlate
    ? `Prato ${nextPlate === 'small' ? 'pequeno' : 'médio'}`
    : 'Aguardando pedido';
  $('queueStatus').textContent = nextPlate
    ? `${data.queue.length} ${data.queue.length === 1 ? 'pedido aguardando' : 'pedidos aguardando'}.`
    : 'Quando um aluno escolher uma porção, ela aparecerá aqui.';
  $('plateQueue').replaceChildren(...data.queue.slice(1).map((type) => {
    const item = document.createElement('li');
    item.textContent = `Prato ${type === 'small' ? 'pequeno' : 'médio'}`;
    return item;
  }));
  renderHistoryReport();
}

function setAppSettingsFormValues() {
  $('votingCutoffInput').value = data.settings.votingCutoff || '10:45';
  $('plateGramsInput').value = data.settings.plateGrams;
  $('riceGramsInput').value = data.settings.riceGrams;
  $('beansGramsInput').value = data.settings.beansGrams;
  $('meatGramsInput').value = data.settings.meatGrams;
  $('plateDisplaySecondsInput').value = data.settings.plateDisplaySeconds;
}

function setMenuFormValues(day = String(new Date().getDay())) {
  const menu = data.weeklyMenus[day] || DEFAULT_MENU;
  $('menuTitleInput').value = menu.title || DEFAULT_MENU.title;
  $('menuMainInput').value = menu.main || '';
  $('menuSideInput').value = menu.side || '';
  $('menuSaladInput').value = menu.salad || '';
  $('menuDessertInput').value = menu.dessert || '';
}

function showPage(pageId) {
  activePage = pageId;
  pages.forEach((id) => $(id).classList.toggle('hidden', id !== pageId));
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === pageId);
  });
  const isTotem = pageId === 'totemPage';
  $('bottomNav').classList.toggle('hidden', isTotem);
  $('dashboard').classList.toggle('totem-mode', isTotem);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('email').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) {
    $('loginError').textContent = 'Preencha o e-mail e a senha para continuar.';
    return;
  }
  const allowedDomain = String(data.settings.loginDomain || 'escola.pr.gov.br').replace(/^@/, '');
  const escapedDomain = allowedDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^[A-Z0-9.!#$%&'*+/=?^_\u0060{|}~-]+@${escapedDomain}$`, 'i').test(email)) {
    $('loginError').textContent = `Acesso recusado. Use um e-mail terminado em @${allowedDomain}.`;
    return;
  }
  loggedIn = true;
  saveData();
  localStorage.setItem(SESSION_KEY, email);
  $('userEmail').textContent = email;
  $('loginError').textContent = '';
  $('loginScreen').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  showPage('filaPage');
  updateDisplay();
});

$('logoutButton').addEventListener('click', () => {
  loggedIn = false;
  localStorage.removeItem(SESSION_KEY);
  $('dashboard').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginPassword').value = '';
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => showPage(button.dataset.page));
});

$('menuDayInput').addEventListener('change', () => {
  setMenuFormValues($('menuDayInput').value);
  $('menuNotice').textContent = '';
});

$('menuForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const day = $('menuDayInput').value;
  data.weeklyMenus[day] = {
    title: $('menuTitleInput').value.trim() || DEFAULT_MENU.title,
    main: $('menuMainInput').value.trim(),
    side: $('menuSideInput').value.trim(),
    salad: $('menuSaladInput').value.trim(),
    dessert: $('menuDessertInput').value.trim()
  };
  saveData();
  updateDisplay();
  const selectedDay = $('menuDayInput').selectedOptions[0].textContent;
  $('menuNotice').textContent = `Cardápio de ${selectedDay} salvo.`;
});

$('wasteForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const amount = Number($('wasteInput').value);
  if (!Number.isFinite(amount) || amount < 0) {
    $('wasteNotice').textContent = 'Informe uma quantidade válida em kg.';
    return;
  }
  rollOverDay();
  data.wasteHistory[dateKey()] = amount;
  saveData();
  updateDisplay();
  $('wasteNotice').textContent = 'Desperdício de hoje salvo.';
});

  $('yesButton').addEventListener('click', () => {
  rollOverDay();
  data.yes += 1;
  saveData();
  updateDisplay();
  $('responseNotice').textContent = data.settings.yesMessage;
});

$('noButton').addEventListener('click', () => {
  rollOverDay();
  data.no += 1;
  saveData();
  updateDisplay();
  $('responseNotice').textContent = data.settings.noMessage;
});

$('repeatButton').addEventListener('click', () => {
  rollOverDay();
  data.yes += 1;
  data.repeat += 1;
  saveData();
  updateDisplay();
  $('responseNotice').textContent = data.settings.repeatMessage;
});

function servePortion(type) {
  if (portionClickLocked || isVotingClosed()) {
    updateDisplay();
    return;
  }

  portionClickLocked = true;
  document.querySelectorAll('.portion-card').forEach((button) => { button.disabled = true; });
  data = loadData();
  if (isVotingClosed()) {
    portionClickLocked = false;
    updateDisplay();
    return;
  }

  if (!data.queue.length) data.queueNextAt = Date.now() + plateDisplayMs();
  data[type] = Number(data[type] || 0) + 1;
  data.queue.push(type);
  saveData();
  updateDisplay();

  const label = type === 'small' ? 'Pequeno' : 'Médio';
  $('totemNotice').textContent = data.settings.portionMessage.replace('{portion}', label.toLowerCase());
  window.setTimeout(() => {
    portionClickLocked = false;
    updateTotemAvailability();
  }, 800);
}

$('smallPortion').addEventListener('click', () => servePortion('small'));
$('mediumPortion').addEventListener('click', () => servePortion('medium'));

$('unlockButton').addEventListener('click', () => {
  $('unlockPin').value = '';
  $('unlockError').textContent = '';
  $('pinModal').classList.remove('hidden');
  $('unlockPin').focus();
});

$('closeModal').addEventListener('click', () => $('pinModal').classList.add('hidden'));
$('pinModal').addEventListener('click', (event) => {
  if (event.target === $('pinModal')) $('pinModal').classList.add('hidden');
});

$('unlockForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if ($('unlockPin').value === data.pin) {
    $('pinModal').classList.add('hidden');
    showPage('filaPage');
  } else {
    $('unlockError').textContent = 'Senha incorreta. Tente novamente.';
    $('unlockPin').select();
  }
});

$('appSettingsForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const cutoff = $('votingCutoffInput').value;
  const plateGrams = Number($('plateGramsInput').value);
  const riceGrams = Number($('riceGramsInput').value);
  const beansGrams = Number($('beansGramsInput').value);
  const meatGrams = Number($('meatGramsInput').value);
  const plateDisplaySeconds = Number($('plateDisplaySecondsInput').value);
  const numericValues = [plateGrams, riceGrams, beansGrams, meatGrams, plateDisplaySeconds];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff) || numericValues.some((value) => !Number.isFinite(value)) || plateGrams <= 0 || plateGrams > 2000 || [riceGrams, beansGrams, meatGrams].some((value) => value < 0 || value > 2000) || plateDisplaySeconds < 1 || plateDisplaySeconds > 300) {
    $('appSettingsNotice').textContent = 'Confira os valores. Os pesos devem estar entre 0 e 2.000 g e o tempo entre 1 e 300 segundos.';
    return;
  }
  data.settings.votingCutoff = cutoff;
  data.settings.plateGrams = plateGrams;
  data.settings.riceGrams = riceGrams;
  data.settings.beansGrams = beansGrams;
  data.settings.meatGrams = meatGrams;
  data.settings.plateDisplaySeconds = plateDisplaySeconds;
  saveData();
  updateDisplay();
  $('appSettingsNotice').textContent = 'Preferências salvas neste navegador.';
});

$('pinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const newPin = $('newPin').value.trim();
  if (!/^\d{4,8}$/.test(newPin)) {
    $('pinNotice').textContent = 'A senha deve ter de 4 a 8 dígitos.';
    return;
  }
  data.pin = newPin;
  saveData();
  $('newPin').value = '';
  $('pinNotice').textContent = 'Senha do Totem atualizada com sucesso.';
});

$('resetButton').addEventListener('click', () => {
  $('resetPin').value = '';
  $('resetError').textContent = '';
  $('resetModal').classList.remove('hidden');
  $('resetPin').focus();
});

function closeResetModal() {
  $('resetModal').classList.add('hidden');
  $('resetForm').reset();
  $('resetError').textContent = '';
}

$('closeResetModal').addEventListener('click', closeResetModal);
$('cancelResetButton').addEventListener('click', closeResetModal);
$('resetModal').addEventListener('click', (event) => {
  if (event.target === $('resetModal')) closeResetModal();
});

$('resetForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if ($('resetPin').value !== data.pin) {
    $('resetError').textContent = 'Senha incorreta. Confira a senha do professor e tente novamente.';
    $('resetPin').select();
    return;
  }

  rollOverDay();
  data.yes = 0;
  data.no = 0;
  data.repeat = 0;
  data.small = 0;
  data.medium = 0;
  data.queue = [];
  data.queueNextAt = null;
  saveData();
  updateDisplay();
  $('responseNotice').textContent = '';
  $('totemNotice').textContent = '';
  closeResetModal();
});

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    data = loadData();
    updateDisplay();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    data = loadData();
    updateDisplay();
  }
});

const savedEmail = localStorage.getItem(SESSION_KEY);
if (savedEmail) {
  loggedIn = true;
  $('userEmail').textContent = savedEmail;
  $('loginScreen').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  showPage('filaPage');
}

$('menuDayInput').value = String(new Date().getDay());
setAppSettingsFormValues();
setInterval(updateDisplay, 10000);
updateDisplay();
setMenuFormValues($('menuDayInput').value);
