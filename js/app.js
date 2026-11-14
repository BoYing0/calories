/**
 * 食谱热量计算器 - 界面与交互
 */
(function () {
  'use strict';

  var Store = window.Store;

  var collator = null;
  try {
    collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  } catch (err) {
    collator = null;
  }

  var state = {
    tab: 'library',
    query: '',
    editingId: null,
    basis: 'per100g',
    pickerQuery: '',
    pickerSelection: [],
    expandedRecordId: null,
    saveDraft: null
  };

  var dom = {};
  var toastTimer = null;
  var confirmState = null;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function compareByName(a, b) {
    return collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name);
  }

  function trimNumber(num) {
    if (!isFinite(num)) return '';
    var rounded = Math.round(num * 100) / 100;
    return String(rounded);
  }

  function kcalLine(value) {
    return value.toFixed(1);
  }

  function unitShort(food) {
    return food.basis === 'per100g' ? '100g' : '份';
  }

  function energyInline(food) {
    return trimNumber(food.energy) + ' kcal / ' + unitShort(food);
  }

  function macroSummary(food) {
    var parts = [];
    if (food.protein != null) parts.push('蛋白 ' + trimNumber(food.protein) + '%');
    if (food.fat != null) parts.push('脂肪 ' + trimNumber(food.fat) + '%');
    if (food.carbs != null) parts.push('碳水 ' + trimNumber(food.carbs) + '%');
    return parts.join(' · ');
  }

  function lineCalories(food, amount) {
    if (!food || !amount) return 0;
    return food.basis === 'per100g' ? (amount / 100) * food.energy : amount * food.energy;
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    cacheDom();
    state.tab = Store.getTab();
    bindEvents();
    applyTabUI();
    renderLibrary();
    renderRecipe();
    renderRecipes();
    registerServiceWorker();
  }

  function cacheDom() {
    var ids = [
      'page-title', 'page-subtitle', 'food-count',
      'view-library', 'view-calc', 'view-recipes',
      'library-search', 'library-list', 'library-empty', 'library-no-result',
      'servings-input', 'recipe-list', 'recipe-empty', 'add-foods', 'clear-recipe',
      'result-card', 'result-total', 'result-per', 'result-meta', 'save-recipe',
      'recipes-list', 'recipes-empty',
      'fab',
      'editor-sheet', 'editor-backdrop', 'editor-title', 'food-form', 'food-name',
      'food-energy', 'food-p', 'food-f', 'food-c', 'food-delete', 'food-error',
      'basis-suffix', 'macro-sum-hint',
      'picker-sheet', 'picker-backdrop', 'picker-search', 'picker-list', 'picker-no-result', 'picker-empty', 'picker-confirm',
      'save-sheet', 'save-backdrop', 'save-form', 'save-name', 'save-summary', 'save-error',
      'confirm-backdrop', 'confirm-title', 'confirm-text', 'confirm-ok', 'confirm-cancel',
      'toast'
    ];
    ids.forEach(function (id) {
      dom[id.replace(/-([a-z])/g, function (_, chr) { return chr.toUpperCase(); })] = document.getElementById(id);
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    $all('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTab(btn.getAttribute('data-tab'));
      });
    });

    dom.fab.addEventListener('click', function () {
      openEditor(null);
    });

    document.addEventListener('click', function (event) {
      var actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');
      if (action === 'new-food') {
        closeSheet('picker', true);
        openEditor(null);
      } else if (action === 'pick-foods') {
        openPicker();
      } else if (action === 'go-calc') {
        setTab('calc');
      }
    });

    dom.librarySearch.addEventListener('input', function () {
      state.query = dom.librarySearch.value;
      renderLibrary();
    });

    dom.libraryList.addEventListener('click', function (event) {
      var row = event.target.closest('.food-row');
      if (!row) return;
      openEditor(Store.getFood(row.getAttribute('data-food-id')));
    });

    dom.libraryList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.food-row');
      if (!row) return;
      event.preventDefault();
      openEditor(Store.getFood(row.getAttribute('data-food-id')));
    });

    $all('[data-close-sheet]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeSheet(btn.getAttribute('data-close-sheet'));
      });
    });

    dom.editorBackdrop.addEventListener('click', function () {
      closeSheet('editor');
    });

    dom.pickerBackdrop.addEventListener('click', function () {
      closeSheet('picker');
    });

    dom.saveBackdrop.addEventListener('click', function () {
      closeSheet('save');
    });

    $all('.seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.basis = btn.getAttribute('data-basis');
        applyBasis();
      });
    });

    [dom.foodP, dom.foodF, dom.foodC].forEach(function (input) {
      input.addEventListener('input', updateMacroHint);
    });

    dom.foodForm.addEventListener('submit', handleFoodSubmit);
    dom.foodDelete.addEventListener('click', deleteEditingFood);

    dom.servingsInput.addEventListener('input', function () {
      var raw = sanitizeNumberText(dom.servingsInput.value);
      if (raw !== dom.servingsInput.value) dom.servingsInput.value = raw;
      var value = Number(raw);
      if (raw !== '' && isFinite(value) && value > 0) Store.setServings(value);
      updateResult();
    });

    dom.servingsInput.addEventListener('blur', function () {
      dom.servingsInput.value = trimNumber(Store.getRecipe().servings);
      updateResult();
    });

    $all('[data-servings-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var step = Number(btn.getAttribute('data-servings-step'));
        var current = Store.getRecipe().servings;
        var next = Math.max(1, Math.min(999, Math.round(current) + step));
        Store.setServings(next);
        dom.servingsInput.value = String(next);
        updateResult();
      });
    });

    dom.recipeList.addEventListener('input', handleAmountInput);
    dom.recipeList.addEventListener('click', handleRecipeClick);
    dom.addFoods.addEventListener('click', openPicker);
    dom.clearRecipe.addEventListener('click', clearRecipe);
    dom.saveRecipe.addEventListener('click', openSaveSheet);
    dom.saveForm.addEventListener('submit', handleRecipeSave);
    dom.recipesList.addEventListener('click', handleRecordClick);
    dom.recipesList.addEventListener('keydown', handleRecordKeydown);

    dom.pickerSearch.addEventListener('input', function () {
      state.pickerQuery = dom.pickerSearch.value;
      renderPicker();
    });

    dom.pickerList.addEventListener('click', function (event) {
      var row = event.target.closest('.pick-row');
      if (!row) return;
      togglePicker(row.getAttribute('data-food-id'));
    });

    dom.pickerList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.pick-row');
      if (!row) return;
      event.preventDefault();
      togglePicker(row.getAttribute('data-food-id'));
    });

    dom.pickerConfirm.addEventListener('click', confirmPicker);

    dom.confirmOk.addEventListener('click', function () {
      settleConfirm(true);
    });
    dom.confirmCancel.addEventListener('click', function () {
      settleConfirm(false);
    });
    dom.confirmBackdrop.addEventListener('click', function (event) {
      if (event.target === dom.confirmBackdrop) settleConfirm(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!dom.confirmBackdrop.hidden) {
        settleConfirm(false);
        return;
      }
      if (!dom.pickerSheet.hidden) {
        closeSheet('picker');
        return;
      }
      if (!dom.saveSheet.hidden) {
        closeSheet('save');
        return;
      }
      if (!dom.editorSheet.hidden) closeSheet('editor');
    });
  }

  /* ---------------- Tab ---------------- */

  function normalizeTab(tab) {
    return tab === 'calc' || tab === 'recipes' ? tab : 'library';
  }

  function applyTabUI() {
    dom.viewLibrary.hidden = state.tab !== 'library';
    dom.viewCalc.hidden = state.tab !== 'calc';
    dom.viewRecipes.hidden = state.tab !== 'recipes';
    dom.fab.hidden = state.tab !== 'library';

    $all('.tab').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === state.tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    updateHeader();
  }

  function setTab(tab) {
    state.tab = normalizeTab(tab);
    Store.setTab(state.tab);
    applyTabUI();
    window.scrollTo(0, 0);
  }

  function updateHeader() {
    if (state.tab === 'library') {
      dom.pageTitle.textContent = '食材库';
      dom.pageSubtitle.textContent = '记录食材能量，随时换算';
      dom.foodCount.textContent = Store.getFoods().length + ' 种';
      dom.foodCount.hidden = false;
    } else if (state.tab === 'calc') {
      dom.pageTitle.textContent = '热量计算';
      dom.pageSubtitle.textContent = '按克重换算整份与单份热量';
      var count = Store.getRecipe().items.length;
      dom.foodCount.textContent = count + ' 种已选';
      dom.foodCount.hidden = count === 0;
    } else {
      dom.pageTitle.textContent = '菜谱';
      dom.pageSubtitle.textContent = '每次制作的原料与成品热量';
      dom.foodCount.textContent = Store.getRecipeRecords().length + ' 个';
      dom.foodCount.hidden = false;
    }
  }

  /* ---------------- 食材库 ---------------- */

  function renderLibrary() {
    var foods = Store.getFoods().sort(compareByName);
    var query = state.query.trim().toLowerCase();
    var filtered = query
      ? foods.filter(function (food) {
          return food.name.toLowerCase().indexOf(query) !== -1;
        })
      : foods;

    dom.libraryList.replaceChildren();
    filtered.forEach(function (food) {
      dom.libraryList.appendChild(createFoodRow(food));
    });

    var hasFoods = foods.length > 0;
    dom.libraryEmpty.hidden = hasFoods;
    dom.libraryList.hidden = filtered.length === 0;
    dom.libraryNoResult.hidden = !hasFoods || filtered.length > 0;

    updateHeader();
  }

  function createFoodRow(food) {
    var row = el('li', 'food-row');
    row.setAttribute('data-food-id', food.id);
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', '编辑食材 ' + food.name);

    var main = el('div', 'food-main');
    main.appendChild(el('div', 'food-name', food.name));

    var macros = macroSummary(food);
    if (macros) {
      main.appendChild(el('div', 'food-meta', macros));
    }

    row.appendChild(main);

    var right = el('div', 'food-right');
    var kcal = el('div', 'food-kcal', trimNumber(food.energy));
    kcal.appendChild(el('small', '', 'kcal'));
    right.appendChild(kcal);
    right.appendChild(el('div', 'food-unit', food.basis === 'per100g' ? '每 100g' : '每份'));
    row.appendChild(right);

    row.appendChild(el('span', 'chevron', '›'));
    return row;
  }

  /* ---------------- 配方计算 ---------------- */

  function renderRecipe() {
    var recipe = Store.getRecipe();
    dom.servingsInput.value = trimNumber(recipe.servings);

    var items = recipe.items.filter(function (item) {
      return !!Store.getFood(item.foodId);
    });

    dom.recipeList.replaceChildren();
    items.forEach(function (item) {
      dom.recipeList.appendChild(createRecipeRow(Store.getFood(item.foodId), item));
    });

    var hasItems = items.length > 0;
    dom.recipeList.hidden = !hasItems;
    dom.recipeEmpty.hidden = hasItems;
    dom.addFoods.hidden = !hasItems;
    dom.resultCard.hidden = !hasItems;
    dom.clearRecipe.hidden = !hasItems;

    updateResult();
    updateHeader();
  }

  function createRecipeRow(food, item) {
    var row = el('li', 'recipe-row');
    row.setAttribute('data-food-id', food.id);

    var main = el('div', 'recipe-main');
    main.appendChild(el('div', 'recipe-name', food.name));

    var sub = el('div', 'recipe-sub');
    sub.appendChild(document.createTextNode(energyInline(food) + ' · 小计 '));
    var subValue = el('b', '', amountLabel(food, item.amount));
    sub.appendChild(subValue);
    sub.appendChild(document.createTextNode(' kcal'));
    main.appendChild(sub);

    row.appendChild(main);

    var control = el('div', 'recipe-control');
    var box = el('div', 'amount-box');
    var input = document.createElement('input');
    input.className = 'amount-input';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.value = item.amount == null ? '' : trimNumber(item.amount);
    input.setAttribute('aria-label', food.name + ' 用量');
    box.appendChild(input);
    box.appendChild(el('span', 'amount-unit', food.basis === 'per100g' ? 'g' : '份'));
    control.appendChild(box);

    var remove = el('button', 'row-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除 ' + food.name);
    control.appendChild(remove);

    row.appendChild(control);
    return row;
  }

  function amountLabel(food, amount) {
    if (amount == null || !isFinite(Number(amount)) || Number(amount) <= 0) return '—';
    return kcalLine(lineCalories(food, Number(amount)));
  }

  function handleAmountInput(event) {
    var input = event.target.closest('.amount-input');
    if (!input) return;

    var row = input.closest('.recipe-row');
    var food = Store.getFood(row.getAttribute('data-food-id'));
    if (!food) return;

    var raw = sanitizeNumberText(input.value);
    if (raw !== input.value) input.value = raw;

    var amount = raw === '' ? null : Number(raw);
    if (amount != null && (!isFinite(amount) || amount < 0)) amount = null;

    Store.setAmount(food.id, amount);

    var subValue = $('.recipe-sub b', row);
    if (subValue) subValue.textContent = amountLabel(food, amount);
    updateResult();
  }

  function handleRecipeClick(event) {
    var btn = event.target.closest('.row-remove');
    if (!btn) return;
    var row = btn.closest('.recipe-row');
    Store.removeRecipeItem(row.getAttribute('data-food-id'));
    renderRecipe();
  }

  function updateResult() {
    var recipe = Store.getRecipe();
    var total = 0;
    var counted = 0;

    recipe.items.forEach(function (item) {
      var food = Store.getFood(item.foodId);
      if (!food) return;
      var amount = Number(item.amount);
      if (item.amount != null && isFinite(amount) && amount > 0) {
        total += lineCalories(food, amount);
        counted++;
      }
    });

    var servings = Number(recipe.servings);
    var validServings = isFinite(servings) && servings > 0;

    dom.resultTotal.textContent = kcalLine(total);
    dom.resultPer.textContent = validServings ? kcalLine(total / servings) : '—';
    dom.resultMeta.textContent = counted + ' 种食材 · ' + (validServings ? trimNumber(servings) : '—') + ' 份';
  }

  function sanitizeNumberText(value) {
    return String(value).replace(/[^\d.,]/g, '').replace(',', '.');
  }

  function clearRecipe() {
    askConfirm({
      title: '清空本次计算？',
      text: '已选食材和用量会被移除，食材库不受影响。',
      okText: '清空',
      danger: false
    }).then(function (ok) {
      if (!ok) return;
      Store.clearRecipe();
      renderRecipe();
      toast('已清空本次计算');
    });
  }

  /* ---------------- 菜谱记录 ---------------- */

  function pad2(num) {
    return num < 10 ? '0' + num : String(num);
  }

  function formatDate(ts) {
    var date = new Date(ts);
    if (isNaN(date.getTime())) return '';
    return date.getFullYear() + '/' + pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function buildRecipeSnapshot() {
    var recipe = Store.getRecipe();
    var items = [];
    recipe.items.forEach(function (item) {
      var food = Store.getFood(item.foodId);
      var amount = Number(item.amount);
      if (!food || item.amount == null || !isFinite(amount) || amount <= 0) return;
      items.push({
        name: food.name,
        amount: amount,
        unit: food.basis === 'per100g' ? 'g' : '份',
        kcal: lineCalories(food, amount)
      });
    });
    return { servings: recipe.servings, items: items };
  }

  function openSaveSheet() {
    var snapshot = buildRecipeSnapshot();
    if (!snapshot.items.length) {
      toast('先填写食材用量再保存');
      return;
    }

    state.saveDraft = snapshot;
    var total = 0;
    snapshot.items.forEach(function (item) {
      total += item.kcal;
    });

    dom.saveName.value = '';
    dom.saveError.hidden = true;
    dom.saveSummary.textContent = snapshot.items.length + ' 种食材 · 总热量 ' + kcalLine(total) +
      ' 千卡 · 单份 ' + kcalLine(total / snapshot.servings) + ' 千卡';
    openSheet('save');
    window.setTimeout(function () {
      dom.saveName.focus();
    }, 320);
  }

  function handleRecipeSave(event) {
    event.preventDefault();

    var snapshot = state.saveDraft;
    if (!snapshot || !snapshot.items.length) {
      dom.saveError.textContent = '当前没有可保存的食材';
      dom.saveError.hidden = false;
      return;
    }

    var name = dom.saveName.value.trim();
    if (!name) {
      dom.saveError.textContent = '请填写成品名称';
      dom.saveError.hidden = false;
      return;
    }

    var record = Store.addRecipeRecord({
      name: name,
      servings: snapshot.servings,
      items: snapshot.items
    });

    if (!record) {
      dom.saveError.textContent = '保存失败，请重试';
      dom.saveError.hidden = false;
      return;
    }

    closeSheet('save');
    state.expandedRecordId = record.id;
    renderRecipes();
    setTab('recipes');
    toast('已保存「' + name + '」');
  }

  function renderRecipes() {
    var records = Store.getRecipeRecords();
    dom.recipesList.replaceChildren();
    records.forEach(function (record) {
      dom.recipesList.appendChild(createRecordCard(record));
    });

    dom.recipesList.hidden = records.length === 0;
    dom.recipesEmpty.hidden = records.length > 0;
    updateHeader();
  }

  function createRecordCard(record) {
    var card = el('li', 'record-card');
    card.setAttribute('data-record-id', record.id);

    var expanded = state.expandedRecordId === record.id;

    var head = el('div', 'record-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(expanded));
    head.setAttribute('aria-label', (expanded ? '收起 ' : '展开 ') + record.name);

    var main = el('div', 'record-main');
    main.appendChild(el('div', 'record-name', record.name));
    main.appendChild(el('div', 'record-meta',
      formatDate(record.createdAt) + ' · ' + record.items.length + ' 种食材 · ' + trimNumber(record.servings) + ' 份'));
    head.appendChild(main);

    var right = el('div', 'record-right');
    var per = el('div', 'record-per', kcalLine(record.perServingKcal));
    per.appendChild(el('small', '', '千卡/份'));
    right.appendChild(per);
    right.appendChild(el('div', 'record-total', '总 ' + kcalLine(record.totalKcal) + ' 千卡'));
    head.appendChild(right);

    head.appendChild(el('span', 'record-chevron', '›'));
    card.appendChild(head);

    var detail = el('div', 'record-detail');
    detail.hidden = !expanded;

    var itemList = el('ul', 'record-items');
    record.items.forEach(function (item) {
      var row = el('li', 'record-item');
      row.appendChild(el('span', 'record-item-name', item.name));
      row.appendChild(el('span', 'record-item-amount',
        (item.amount == null ? '—' : trimNumber(item.amount)) + ' ' + item.unit));
      row.appendChild(el('span', 'record-item-kcal', kcalLine(item.kcal) + ' 千卡'));
      itemList.appendChild(row);
    });
    detail.appendChild(itemList);

    var actions = el('div', 'record-actions');
    var remove = el('button', 'record-delete', '删除记录');
    remove.type = 'button';
    remove.setAttribute('data-record-delete', record.id);
    actions.appendChild(remove);
    detail.appendChild(actions);

    card.appendChild(detail);
    return card;
  }

  function toggleRecord(id) {
    state.expandedRecordId = state.expandedRecordId === id ? null : id;
    renderRecipes();
  }

  function handleRecordClick(event) {
    var remove = event.target.closest('[data-record-delete]');
    if (remove) {
      deleteRecord(remove.getAttribute('data-record-delete'));
      return;
    }
    var head = event.target.closest('.record-head');
    if (!head) return;
    toggleRecord(head.closest('.record-card').getAttribute('data-record-id'));
  }

  function handleRecordKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var head = event.target.closest('.record-head');
    if (!head) return;
    event.preventDefault();
    toggleRecord(head.closest('.record-card').getAttribute('data-record-id'));
  }

  function deleteRecord(id) {
    var record = Store.getRecipeRecord(id);
    if (!record) return;

    askConfirm({
      title: '删除「' + record.name + '」？',
      text: '这条制作记录会被删除，无法恢复。',
      okText: '删除',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.deleteRecipeRecord(id);
      if (state.expandedRecordId === id) state.expandedRecordId = null;
      renderRecipes();
      toast('已删除记录');
    });
  }

  /* ---------------- 选择食材 ---------------- */

  function openPicker() {
    state.pickerQuery = '';
    state.pickerSelection = [];
    dom.pickerSearch.value = '';
    renderPicker();
    openSheet('picker');
    window.setTimeout(function () {
      dom.pickerSearch.focus();
    }, 320);
  }

  function renderPicker() {
    var foods = Store.getFoods().sort(compareByName);
    var query = state.pickerQuery.trim().toLowerCase();
    var filtered = query
      ? foods.filter(function (food) {
          return food.name.toLowerCase().indexOf(query) !== -1;
        })
      : foods;

    var inRecipe = {};
    Store.getRecipe().items.forEach(function (item) {
      inRecipe[item.foodId] = true;
    });

    dom.pickerList.replaceChildren();

    filtered.forEach(function (food) {
      var locked = !!inRecipe[food.id];
      var selected = state.pickerSelection.indexOf(food.id) !== -1;
      var row = el('li', 'pick-row');
      row.setAttribute('data-food-id', food.id);
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      if (locked) {
        row.classList.add('is-locked');
        row.setAttribute('aria-disabled', 'true');
      } else if (selected) {
        row.classList.add('is-selected');
      }
      row.setAttribute('aria-pressed', String(selected && !locked));
      row.setAttribute('aria-label', (locked ? '已添加 ' : '选择 ') + food.name);

      var check = el('span', 'pick-check');
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7.5"/></svg>';
      row.appendChild(check);

      var info = el('div', 'pick-info');
      info.appendChild(el('div', 'food-name', food.name));
      var macros = macroSummary(food);
      if (macros) info.appendChild(el('div', 'food-meta', macros));
      row.appendChild(info);

      row.appendChild(el('span', 'pick-value', locked ? '已添加' : energyInline(food)));
      dom.pickerList.appendChild(row);
    });

    var hasFoods = foods.length > 0;
    dom.pickerEmpty.hidden = hasFoods;
    dom.pickerList.hidden = filtered.length === 0;
    dom.pickerNoResult.hidden = !hasFoods || filtered.length > 0;
    updatePickerFooter();
  }

  function updatePickerFooter() {
    var count = state.pickerSelection.length;
    dom.pickerConfirm.disabled = count === 0;
    dom.pickerConfirm.textContent = count === 0 ? '请选择食材' : '添加 ' + count + ' 种食材';
  }

  function togglePicker(foodId) {
    var inRecipe = Store.getRecipe().items.some(function (item) {
      return item.foodId === foodId;
    });
    if (inRecipe) return;

    var idx = state.pickerSelection.indexOf(foodId);
    if (idx === -1) {
      state.pickerSelection.push(foodId);
    } else {
      state.pickerSelection.splice(idx, 1);
    }
    renderPicker();
  }

  function confirmPicker() {
    if (!state.pickerSelection.length) return;
    var added = Store.addRecipeItems(state.pickerSelection);
    state.pickerSelection = [];
    closeSheet('picker');
    renderRecipe();
    if (added) toast('已添加 ' + added + ' 种食材');
  }

  /* ---------------- 食材编辑 ---------------- */

  function openEditor(food) {
    state.editingId = food ? food.id : null;
    state.basis = food ? food.basis : 'per100g';

    dom.foodForm.reset();
    dom.editorTitle.textContent = food ? '编辑食材' : '添加食材';
    dom.foodName.value = food ? food.name : '';
    dom.foodEnergy.value = food ? trimNumber(food.energy) : '';
    dom.foodP.value = food && food.protein != null ? trimNumber(food.protein) : '';
    dom.foodF.value = food && food.fat != null ? trimNumber(food.fat) : '';
    dom.foodC.value = food && food.carbs != null ? trimNumber(food.carbs) : '';
    dom.foodDelete.hidden = !food;
    dom.foodError.hidden = true;

    applyBasis();
    updateMacroHint();
    openSheet('editor');

    window.setTimeout(function () {
      dom.foodName.focus();
    }, 320);
  }

  function applyBasis() {
    var perServing = state.basis === 'perServing';
    $all('.seg-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-basis') === state.basis;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    dom.basisSuffix.textContent = perServing ? 'kcal / 份' : 'kcal / 100g';
    dom.foodEnergy.setAttribute('placeholder', perServing ? '如：120' : '如：250');
  }

  function parsePercent(input) {
    var raw = sanitizeNumberText(input.value).trim();
    if (raw === '') return { ok: true, value: null };
    var num = Number(raw);
    if (!isFinite(num) || num < 0 || num > 100) return { ok: false, value: null };
    return { ok: true, value: num };
  }

  function updateMacroHint() {
    var sum = 0;
    var filled = 0;
    [dom.foodP, dom.foodF, dom.foodC].forEach(function (input) {
      var result = parsePercent(input);
      if (result.ok && result.value != null) {
        sum += result.value;
        filled++;
      }
    });

    if (!filled) {
      dom.macroSumHint.textContent = '按能量占比记录，仅用于列表展示';
      dom.macroSumHint.classList.remove('is-warning');
      return;
    }

    dom.macroSumHint.textContent = '已填写合计 ' + trimNumber(sum) + '%（仅用于展示）';
    dom.macroSumHint.classList.toggle('is-warning', sum > 100);
  }

  function showFormError(message) {
    dom.foodError.textContent = message;
    dom.foodError.hidden = false;
  }

  function handleFoodSubmit(event) {
    event.preventDefault();

    var name = dom.foodName.value.trim();
    if (!name) {
      showFormError('请填写食材名称');
      return;
    }

    var energyRaw = sanitizeNumberText(dom.foodEnergy.value).trim();
    var energy = Number(energyRaw);
    if (energyRaw === '' || !isFinite(energy) || energy < 0) {
      showFormError('请填写有效的能量值（kcal）');
      return;
    }

    var protein = parsePercent(dom.foodP);
    var fat = parsePercent(dom.foodF);
    var carbs = parsePercent(dom.foodC);
    if (!protein.ok || !fat.ok || !carbs.ok) {
      showFormError('营养占比请填写 0–100 之间的数字');
      return;
    }

    var isEdit = !!state.editingId;
    var saved = Store.saveFood({
      id: state.editingId || undefined,
      name: name,
      basis: state.basis,
      energy: energy,
      protein: protein.value,
      fat: fat.value,
      carbs: carbs.value
    });

    if (!saved) {
      showFormError('保存失败，请检查后重试');
      return;
    }

    closeSheet('editor');
    renderLibrary();
    renderRecipe();
    toast(isEdit ? '已保存修改' : '已添加食材');
  }

  function deleteEditingFood() {
    var food = Store.getFood(state.editingId);
    if (!food) return;

    askConfirm({
      title: '删除「' + food.name + '」？',
      text: '删除后无法恢复，也会从本次计算中移除。',
      okText: '删除',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.deleteFood(food.id);
      closeSheet('editor');
      renderLibrary();
      renderRecipe();
      toast('已删除「' + food.name + '」');
    });
  }

  /* ---------------- 弹层 ---------------- */

  function getSheetParts(name) {
    if (name === 'picker') {
      return { sheet: dom.pickerSheet, backdrop: dom.pickerBackdrop };
    }
    if (name === 'save') {
      return { sheet: dom.saveSheet, backdrop: dom.saveBackdrop };
    }
    return { sheet: dom.editorSheet, backdrop: dom.editorBackdrop };
  }

  function openSheet(name) {
    var parts = getSheetParts(name);
    parts.sheet.hidden = false;
    parts.backdrop.hidden = false;
    document.body.classList.add('sheet-open');

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        parts.sheet.classList.add('is-open');
        parts.backdrop.classList.add('is-open');
      });
    });
  }

  function closeSheet(name, immediate) {
    var parts = getSheetParts(name);
    parts.sheet.classList.remove('is-open');
    parts.backdrop.classList.remove('is-open');

    if (immediate) {
      parts.sheet.hidden = true;
      parts.backdrop.hidden = true;
    } else {
      window.setTimeout(function () {
        if (!parts.sheet.classList.contains('is-open')) {
          parts.sheet.hidden = true;
          parts.backdrop.hidden = true;
        }
      }, 300);
    }

    document.body.classList.remove('sheet-open');
    if (name === 'editor') state.editingId = null;
    if (name === 'save') state.saveDraft = null;
  }

  /* ---------------- 确认弹窗 / Toast ---------------- */

  function askConfirm(options) {
    return new Promise(function (resolve) {
      if (confirmState) confirmState.resolve(false);

      confirmState = { resolve: resolve };
      dom.confirmTitle.textContent = options.title || '确认操作？';
      dom.confirmText.textContent = options.text || '';
      dom.confirmOk.textContent = options.okText || '确定';
      dom.confirmOk.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary');
      dom.confirmBackdrop.hidden = false;
      dom.confirmOk.focus();
    });
  }

  function settleConfirm(result) {
    if (!confirmState) return;
    var resolve = confirmState.resolve;
    confirmState = null;
    dom.confirmBackdrop.hidden = true;
    resolve(result);
  }

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove('is-visible');
    }, 2000);
  }

  /* ---------------- PWA ---------------- */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // 注册失败不影响离线以外的功能
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
