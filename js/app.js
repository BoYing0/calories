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

  var KJ_PER_KCAL = 4.184;

  var state = {
    tab: 'library',
    query: '',
    editingId: null,
    basis: 'per100g',
    energyUnit: 'kj',
    pickerQuery: '',
    pickerSelection: [],
    editingRecipeId: null,
    recipeDraft: null,
    expandedRecipeId: null
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

  function kcalShort(value) {
    return trimNumber(Math.round(value * 10) / 10);
  }

  function toKcal(value, unit) {
    return unit === 'kj' ? value / KJ_PER_KCAL : value;
  }

  function fromKcal(kcal, unit) {
    return unit === 'kj' ? kcal * KJ_PER_KCAL : kcal;
  }

  function unitShort(food) {
    return food.basis === 'per100g' ? '100g' : '份';
  }

  function energyInline(food) {
    return kcalShort(food.energy) + ' 千卡 / ' + unitShort(food);
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
      'recipe-sheet', 'recipe-backdrop', 'recipe-sheet-title', 'recipe-form', 'recipe-name',
      'recipe-servings', 'recipe-items', 'recipe-delete', 'recipe-error',
      'picker-sheet', 'picker-backdrop', 'picker-search', 'picker-list', 'picker-no-result', 'picker-empty', 'picker-confirm',
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

    dom.recipeBackdrop.addEventListener('click', function () {
      closeSheet('recipe');
    });

    $all('.seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.basis = btn.getAttribute('data-basis');
        applyBasis();
      });
    });

    $all('.unit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setEnergyUnit(btn.getAttribute('data-energy-unit'), true);
      });
    });

    [dom.foodP, dom.foodF, dom.foodC].forEach(function (input) {
      input.addEventListener('input', updateMacroHint);
    });

    dom.foodForm.addEventListener('submit', handleFoodSubmit);
    dom.foodDelete.addEventListener('click', deleteEditingFood);

    dom.saveRecipe.addEventListener('click', function () {
      openRecipeEditor(null);
    });
    dom.recipeForm.addEventListener('submit', handleRecipeSubmit);
    dom.recipeDelete.addEventListener('click', deleteEditingRecipe);
    dom.recipeItems.addEventListener('input', handleRecipeAmountInput);

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
      if (!dom.recipeSheet.hidden) {
        closeSheet('recipe');
        return;
      }
      if (!dom.editorSheet.hidden) closeSheet('editor');
    });
  }

  /* ---------------- Tab ---------------- */

  function applyTabUI() {
    var isLibrary = state.tab === 'library';
    var isCalc = state.tab === 'calc';
    dom.viewLibrary.hidden = !isLibrary;
    dom.viewCalc.hidden = !isCalc;
    dom.viewRecipes.hidden = state.tab !== 'recipes';
    dom.fab.hidden = !isLibrary;

    $all('.tab').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === state.tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    updateHeader();
  }

  function setTab(tab) {
    state.tab = tab === 'calc' || tab === 'recipes' ? tab : 'library';
    Store.setTab(state.tab);
    applyTabUI();
    if (state.tab === 'recipes') {
      state.expandedRecipeId = null;
      renderRecipes();
    }
    window.scrollTo(0, 0);
  }

  function updateHeader() {
    var isLibrary = state.tab === 'library';
    var isCalc = state.tab === 'calc';

    if (isLibrary) {
      dom.pageTitle.textContent = '食材库';
      dom.pageSubtitle.textContent = '记录食材能量，随时换算';
      dom.foodCount.textContent = Store.getFoods().length + ' 种';
      dom.foodCount.hidden = false;
    } else if (isCalc) {
      dom.pageTitle.textContent = '热量计算';
      dom.pageSubtitle.textContent = '按克重换算整份与单份热量';
      var count = Store.getRecipe().items.length;
      dom.foodCount.textContent = count + ' 种已选';
      dom.foodCount.hidden = count === 0;
    } else {
      dom.pageTitle.textContent = '我的菜谱';
      dom.pageSubtitle.textContent = '记录每次制作的原料与成品热量';
      var total = Store.getSavedRecipes().length;
      dom.foodCount.textContent = total + ' 条';
      dom.foodCount.hidden = total === 0;
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
    var kcal = el('div', 'food-kcal', kcalShort(food.energy));
    kcal.appendChild(el('small', '', '千卡'));
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
    sub.appendChild(document.createTextNode(' 千卡'));
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

  /* ---------------- 已保存菜谱 ---------------- */

  function savedItemKcal(item) {
    return item.basis === 'per100g' ? (item.amount / 100) * item.energy : item.amount * item.energy;
  }

  function savedTotal(entry) {
    return entry.items.reduce(function (sum, item) {
      return sum + savedItemKcal(item);
    }, 0);
  }

  function formatDate(timestamp) {
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    var now = new Date();
    var prefix = date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '年';
    return prefix + (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }

  function renderRecipes() {
    var entries = Store.getSavedRecipes();

    dom.recipesList.replaceChildren();
    entries.forEach(function (entry) {
      dom.recipesList.appendChild(createSavedCard(entry));
    });

    dom.recipesList.hidden = entries.length === 0;
    dom.recipesEmpty.hidden = entries.length > 0;
    updateHeader();
  }

  function createSavedCard(entry) {
    var total = savedTotal(entry);
    var card = el('li', 'saved-card');
    card.setAttribute('data-recipe-id', entry.id);

    var head = el('button', 'saved-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(state.expandedRecipeId === entry.id));

    var main = el('div', 'saved-main');
    main.appendChild(el('div', 'saved-name', entry.name));
    main.appendChild(el('div', 'saved-meta',
      entry.items.length + ' 种原料 · ' + trimNumber(entry.servings) + ' 份 · ' + formatDate(entry.updatedAt)));
    head.appendChild(main);

    var right = el('div', 'saved-right');
    var per = el('div', 'saved-kcal', kcalLine(total / entry.servings));
    per.appendChild(el('small', '', '千卡/份'));
    right.appendChild(per);
    right.appendChild(el('div', 'saved-total', '总 ' + kcalLine(total) + ' 千卡'));
    head.appendChild(right);

    head.addEventListener('click', function () {
      state.expandedRecipeId = state.expandedRecipeId === entry.id ? null : entry.id;
      renderRecipes();
    });
    card.appendChild(head);

    var detail = el('div', 'saved-detail');
    detail.hidden = state.expandedRecipeId !== entry.id;

    var items = el('ul', 'saved-items');
    entry.items.forEach(function (item) {
      var row = el('li', 'saved-item');
      row.appendChild(el('span', 'saved-item-name', item.name));
      row.appendChild(el('span', 'saved-item-amount',
        trimNumber(item.amount) + (item.basis === 'per100g' ? 'g' : ' 份')));
      row.appendChild(el('span', 'saved-item-kcal', kcalLine(savedItemKcal(item)) + ' 千卡'));
      items.appendChild(row);
    });
    detail.appendChild(items);

    var actions = el('div', 'saved-actions');
    var edit = el('button', 'btn btn-ghost', '编辑');
    edit.type = 'button';
    edit.addEventListener('click', function () {
      openRecipeEditor(entry);
    });
    var remove = el('button', 'btn btn-ghost-danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      askConfirm({
        title: '删除「' + entry.name + '」？',
        text: '删除后无法恢复。',
        okText: '删除',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        Store.deleteSavedRecipe(entry.id);
        if (state.expandedRecipeId === entry.id) state.expandedRecipeId = null;
        renderRecipes();
        toast('已删除菜谱');
      });
    });
    actions.appendChild(edit);
    actions.appendChild(remove);
    detail.appendChild(actions);

    card.appendChild(detail);
    return card;
  }

  /* ---------------- 菜谱保存 / 编辑 ---------------- */

  function buildDraftFromCalc() {
    var recipe = Store.getRecipe();
    var items = [];

    recipe.items.forEach(function (item) {
      var food = Store.getFood(item.foodId);
      if (!food) return;
      var amount = Number(item.amount);
      if (item.amount == null || !isFinite(amount) || amount <= 0) return;
      items.push({
        name: food.name,
        basis: food.basis,
        energy: food.energy,
        amount: amount
      });
    });

    if (!items.length) return null;
    return { name: '', servings: recipe.servings, items: items };
  }

  function openRecipeEditor(entry) {
    var draft;
    if (entry) {
      draft = {
        name: entry.name,
        servings: entry.servings,
        items: entry.items.map(function (item) {
          return Object.assign({}, item);
        })
      };
    } else {
      draft = buildDraftFromCalc();
    }

    if (!draft) {
      toast('先添加食材并输入用量');
      return;
    }

    state.editingRecipeId = entry ? entry.id : null;
    state.recipeDraft = draft;

    dom.recipeSheetTitle.textContent = entry ? '编辑菜谱' : '保存菜谱';
    dom.recipeName.value = draft.name;
    dom.recipeServings.value = trimNumber(draft.servings);
    dom.recipeDelete.hidden = !entry;
    dom.recipeError.hidden = true;

    renderRecipeEditorItems();
    openSheet('recipe');

    window.setTimeout(function () {
      dom.recipeName.focus();
    }, 320);
  }

  function renderRecipeEditorItems() {
    var draft = state.recipeDraft;
    if (!draft) return;

    dom.recipeItems.replaceChildren();

    draft.items.forEach(function (item, index) {
      var row = el('li', 'recipe-row');
      row.setAttribute('data-index', String(index));

      var main = el('div', 'recipe-main');
      main.appendChild(el('div', 'recipe-name', item.name));
      main.appendChild(el('div', 'recipe-sub',
        kcalShort(item.energy) + ' 千卡 / ' + (item.basis === 'per100g' ? '100g' : '份')));
      row.appendChild(main);

      var control = el('div', 'recipe-control');
      var box = el('div', 'amount-box');
      var input = document.createElement('input');
      input.className = 'amount-input edit-amount';
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.value = trimNumber(item.amount);
      input.setAttribute('aria-label', item.name + ' 用量');
      box.appendChild(input);
      box.appendChild(el('span', 'amount-unit', item.basis === 'per100g' ? 'g' : '份'));
      control.appendChild(box);

      var remove = el('button', 'row-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', '移除 ' + item.name);
      remove.addEventListener('click', function () {
        draft.items.splice(index, 1);
        renderRecipeEditorItems();
      });
      control.appendChild(remove);

      row.appendChild(control);
      dom.recipeItems.appendChild(row);
    });

    if (!draft.items.length) {
      dom.recipeItems.appendChild(el('li', 'list-empty', '没有原料了，可在计算页重新选择后保存'));
    }
  }

  function handleRecipeAmountInput(event) {
    var input = event.target.closest('.edit-amount');
    if (!input || !state.recipeDraft) return;

    var row = input.closest('[data-index]');
    if (!row) return;
    var index = Number(row.getAttribute('data-index'));
    var item = state.recipeDraft.items[index];
    if (!item) return;

    var raw = sanitizeNumberText(input.value);
    if (raw !== input.value) input.value = raw;

    var value = raw === '' ? 0 : Number(raw);
    if (!isFinite(value) || value < 0) value = 0;
    item.amount = value;
  }

  function showRecipeError(message) {
    dom.recipeError.textContent = message;
    dom.recipeError.hidden = false;
  }

  function handleRecipeSubmit(event) {
    event.preventDefault();
    if (!state.recipeDraft) return;

    var name = dom.recipeName.value.trim();
    if (!name) {
      showRecipeError('请填写菜谱名称');
      return;
    }

    var servingsRaw = sanitizeNumberText(dom.recipeServings.value).trim();
    var servings = Number(servingsRaw);
    if (servingsRaw === '' || !isFinite(servings) || servings <= 0) {
      showRecipeError('份数需大于 0');
      return;
    }

    var items = state.recipeDraft.items.filter(function (item) {
      return item.amount > 0;
    });
    if (!items.length) {
      showRecipeError('至少保留一种原料的用量');
      return;
    }

    var isEdit = !!state.editingRecipeId;
    var saved = Store.saveSavedRecipe({
      id: state.editingRecipeId || undefined,
      name: name,
      servings: servings,
      items: items
    });

    if (!saved) {
      showRecipeError('保存失败，请重试');
      return;
    }

    closeSheet('recipe');
    renderRecipes();
    toast(isEdit ? '菜谱已更新' : '已保存到菜谱');
  }

  function deleteEditingRecipe() {
    var id = state.editingRecipeId;
    if (!id) return;
    var name = state.recipeDraft ? state.recipeDraft.name : '这条菜谱';

    askConfirm({
      title: '删除「' + (name || '这条菜谱') + '」？',
      text: '删除后无法恢复。',
      okText: '删除',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      Store.deleteSavedRecipe(id);
      closeSheet('recipe');
      if (state.expandedRecipeId === id) state.expandedRecipeId = null;
      renderRecipes();
      toast('已删除菜谱');
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
    state.energyUnit = 'kj';

    dom.foodForm.reset();
    dom.editorTitle.textContent = food ? '编辑食材' : '添加食材';
    dom.foodName.value = food ? food.name : '';
    dom.foodEnergy.value = food ? trimNumber(fromKcal(food.energy, 'kj')) : '';
    dom.foodP.value = food && food.protein != null ? trimNumber(food.protein) : '';
    dom.foodF.value = food && food.fat != null ? trimNumber(food.fat) : '';
    dom.foodC.value = food && food.carbs != null ? trimNumber(food.carbs) : '';
    dom.foodDelete.hidden = !food;
    dom.foodError.hidden = true;

    setEnergyUnit('kj', false);
    updateMacroHint();
    openSheet('editor');

    window.setTimeout(function () {
      dom.foodName.focus();
    }, 320);
  }

  function setEnergyUnit(unit, convert) {
    var next = unit === 'kcal' ? 'kcal' : 'kj';
    if (convert && next !== state.energyUnit) {
      var raw = sanitizeNumberText(dom.foodEnergy.value).trim();
      var num = Number(raw);
      if (raw !== '' && isFinite(num) && num >= 0) {
        var kcal = toKcal(num, state.energyUnit);
        dom.foodEnergy.value = trimNumber(fromKcal(kcal, next));
      }
    }
    state.energyUnit = next;

    $all('.unit-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-energy-unit') === next;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });

    applyBasis();
  }

  function applyBasis() {
    var perServing = state.basis === 'perServing';
    $all('.seg-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-basis') === state.basis;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });

    var isKj = state.energyUnit === 'kj';
    dom.basisSuffix.textContent = (isKj ? 'kJ' : '千卡') + (perServing ? ' / 份' : ' / 100g');
    dom.foodEnergy.setAttribute('placeholder',
      isKj ? (perServing ? '如：500' : '如：1000') : (perServing ? '如：120' : '如：250'));
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
      showFormError('请填写有效的能量值');
      return;
    }
    var energyKcal = toKcal(energy, state.energyUnit);

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
      energy: energyKcal,
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
    if (name === 'recipe') {
      return { sheet: dom.recipeSheet, backdrop: dom.recipeBackdrop };
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
    if (name === 'recipe') {
      state.editingRecipeId = null;
      state.recipeDraft = null;
    }
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
