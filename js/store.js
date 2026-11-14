/**
 * 数据层：食材库 + 当前配方草稿，全部保存在 localStorage。
 */
(function () {
  'use strict';

  var FOODS_KEY = 'fcc.foods.v1';
  var RECIPE_KEY = 'fcc.recipe.v1';
  var RECORDS_KEY = 'fcc.records.v1';
  var TAB_KEY = 'fcc.tab.v1';

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // 存储不可用（如隐私模式）时静默降级，仅影响持久化
    }
  }

  function uid() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function percentOrNull(value) {
    if (value == null || value === '') return null;
    var num = Number(value);
    if (!isFinite(num) || num < 0) return null;
    return num;
  }

  function normalizeFood(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name == null ? '' : raw.name).trim();
    if (!name) return null;
    var energy = Number(raw.energy);
    if (!isFinite(energy) || energy < 0) energy = 0;
    return {
      id: raw.id ? String(raw.id) : uid(),
      name: name,
      basis: raw.basis === 'perServing' ? 'perServing' : 'per100g',
      energy: energy,
      protein: percentOrNull(raw.protein),
      fat: percentOrNull(raw.fat),
      carbs: percentOrNull(raw.carbs),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function loadFoods() {
    var list = read(FOODS_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeFood).filter(Boolean);
  }

  var foods = loadFoods();

  function indexOfFood(id) {
    for (var i = 0; i < foods.length; i++) {
      if (foods[i].id === id) return i;
    }
    return -1;
  }

  function getFoodById(id) {
    var idx = indexOfFood(id);
    return idx === -1 ? null : foods[idx];
  }

  function persistFoods() {
    write(FOODS_KEY, foods);
  }

  function loadRecipe() {
    var raw = read(RECIPE_KEY, null);
    var servings = raw ? Number(raw.servings) : NaN;
    if (!isFinite(servings) || servings <= 0) servings = 1;

    var rawItems = raw && Array.isArray(raw.items) ? raw.items : [];
    var seen = {};
    var items = [];

    rawItems.forEach(function (item) {
      if (!item || !item.foodId) return;
      var foodId = String(item.foodId);
      if (seen[foodId] || !getFoodById(foodId)) return;
      seen[foodId] = true;
      var amount = item.amount == null || item.amount === '' ? null : Number(item.amount);
      if (amount != null && (!isFinite(amount) || amount < 0)) amount = null;
      items.push({ foodId: foodId, amount: amount });
    });

    return { servings: servings, items: items };
  }

  var recipe = loadRecipe();

  function normalizeRecordItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name == null ? '' : raw.name).trim();
    if (!name) return null;
    var amount = raw.amount == null || raw.amount === '' ? null : Number(raw.amount);
    if (amount != null && (!isFinite(amount) || amount < 0)) amount = null;
    var kcal = Number(raw.kcal);
    if (!isFinite(kcal) || kcal < 0) kcal = 0;
    return {
      name: name,
      amount: amount,
      unit: raw.unit === '份' ? '份' : 'g',
      kcal: kcal
    };
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name == null ? '' : raw.name).trim();
    if (!name) return null;
    var servings = Number(raw.servings);
    if (!isFinite(servings) || servings <= 0) servings = 1;
    var items = Array.isArray(raw.items) ? raw.items.map(normalizeRecordItem).filter(Boolean) : [];
    if (!items.length) return null;

    var totalKcal = 0;
    items.forEach(function (item) {
      totalKcal += item.kcal;
    });

    return {
      id: raw.id ? String(raw.id) : uid(),
      name: name,
      servings: servings,
      items: items,
      totalKcal: totalKcal,
      perServingKcal: totalKcal / servings,
      createdAt: Number(raw.createdAt) || Date.now()
    };
  }

  function loadRecords() {
    var list = read(RECORDS_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeRecord).filter(Boolean).sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
  }

  var records = loadRecords();

  function persistRecords() {
    write(RECORDS_KEY, records);
  }

  function findRecord(id) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) return records[i];
    }
    return null;
  }

  var tab = read(TAB_KEY, 'library');

  function persistRecipe() {
    write(RECIPE_KEY, recipe);
  }

  function findRecipeItem(foodId) {
    for (var i = 0; i < recipe.items.length; i++) {
      if (recipe.items[i].foodId === foodId) return recipe.items[i];
    }
    return null;
  }

  window.Store = {
    getFoods: function () {
      return foods.slice();
    },

    getFood: function (id) {
      return getFoodById(id);
    },

    saveFood: function (data) {
      if (!data) return null;
      var idx = data.id ? indexOfFood(data.id) : -1;
      var food;
      if (idx !== -1) {
        food = normalizeFood(Object.assign({}, foods[idx], data, { id: data.id }));
      } else {
        food = normalizeFood(data);
      }
      if (!food) return null;
      if (idx !== -1) {
        foods[idx] = food;
      } else {
        foods.push(food);
      }
      persistFoods();
      return food;
    },

    deleteFood: function (id) {
      var idx = indexOfFood(id);
      if (idx === -1) return false;
      foods.splice(idx, 1);
      persistFoods();

      var before = recipe.items.length;
      recipe.items = recipe.items.filter(function (item) {
        return item.foodId !== id;
      });
      if (before !== recipe.items.length) persistRecipe();
      return true;
    },

    getRecipe: function () {
      return {
        servings: recipe.servings,
        items: recipe.items.map(function (item) {
          return { foodId: item.foodId, amount: item.amount };
        })
      };
    },

    setServings: function (value) {
      var num = Number(value);
      if (!isFinite(num) || num <= 0) return;
      recipe.servings = num;
      persistRecipe();
    },

    addRecipeItems: function (ids) {
      var added = 0;
      ids.forEach(function (id) {
        var food = getFoodById(id);
        if (!food || findRecipeItem(id)) return;
        recipe.items.push({
          foodId: id,
          amount: food.basis === 'per100g' ? 100 : 1
        });
        added++;
      });
      if (added) persistRecipe();
      return added;
    },

    setAmount: function (foodId, amount) {
      var item = findRecipeItem(foodId);
      if (!item) return;
      item.amount = amount;
      persistRecipe();
    },

    removeRecipeItem: function (foodId) {
      var before = recipe.items.length;
      recipe.items = recipe.items.filter(function (item) {
        return item.foodId !== foodId;
      });
      if (before !== recipe.items.length) persistRecipe();
    },

    clearRecipe: function () {
      recipe = { servings: recipe.servings, items: [] };
      persistRecipe();
    },

    getTab: function () {
      return tab === 'calc' || tab === 'recipes' ? tab : 'library';
    },

    setTab: function (next) {
      tab = next === 'calc' || next === 'recipes' ? next : 'library';
      write(TAB_KEY, tab);
    },

    getRecipeRecords: function () {
      return records.map(function (record) {
        return Object.assign({}, record, {
          items: record.items.map(function (item) {
            return Object.assign({}, item);
          })
        });
      });
    },

    getRecipeRecord: function (id) {
      return findRecord(id);
    },

    addRecipeRecord: function (data) {
      var record = normalizeRecord(data);
      if (!record) return null;
      records.unshift(record);
      persistRecords();
      return record;
    },

    deleteRecipeRecord: function (id) {
      var before = records.length;
      records = records.filter(function (record) {
        return record.id !== id;
      });
      if (before === records.length) return false;
      persistRecords();
      return true;
    }
  };
})();
