/**
 * 数据层：食材库 + 当前配方草稿，全部保存在 localStorage。
 */
(function () {
  'use strict';

  var FOODS_KEY = 'fcc.foods.v1';
  var RECIPE_KEY = 'fcc.recipe.v1';
  var RECIPES_KEY = 'fcc.recipes.v1';
  var TAB_KEY = 'fcc.tab.v1';
  var KJ_PER_KCAL = 4.184;

  /* 旧版本把千卡存成 2 位小数，整数千焦换算后会有 0.01~0.02 的累计偏差；
     把接近整数千焦的值还原为整数千焦，保证总量与用户输入一致 */
  function refineEnergy(kcal) {
    var kj = kcal * KJ_PER_KCAL;
    var nearest = Math.round(kj);
    if (nearest > 0 && Math.abs(kj - nearest) < 0.03) {
      return nearest / KJ_PER_KCAL;
    }
    return kcal;
  }

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

  function rid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
      energy: refineEnergy(energy),
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
  var tab = read(TAB_KEY, 'library');

  function persistRecipe() {
    write(RECIPE_KEY, recipe);
  }

  /* ---------------- 已保存菜谱（快照） ---------------- */

  function normalizeSavedItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name == null ? '' : raw.name).trim();
    if (!name) return null;
    var energy = Number(raw.energy);
    if (!isFinite(energy) || energy < 0) energy = 0;
    var amount = Number(raw.amount);
    if (!isFinite(amount) || amount < 0) amount = 0;
    return {
      name: name,
      basis: raw.basis === 'perServing' ? 'perServing' : 'per100g',
      energy: refineEnergy(energy),
      amount: amount
    };
  }

  function normalizeSavedRecipe(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name == null ? '' : raw.name).trim();
    if (!name) return null;
    var servings = Number(raw.servings);
    if (!isFinite(servings) || servings <= 0) servings = 1;
    var items = (Array.isArray(raw.items) ? raw.items : []).map(normalizeSavedItem).filter(Boolean);
    if (!items.length) return null;
    return {
      id: raw.id ? String(raw.id) : rid(),
      name: name,
      servings: servings,
      items: items,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function loadSavedRecipes() {
    var list = read(RECIPES_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.map(function (raw) {
      return normalizeSavedRecipe(raw) || adaptLegacyEntry(raw);
    }).filter(Boolean);
  }

  var savedRecipes = loadSavedRecipes();

  function persistSavedRecipes() {
    write(RECIPES_KEY, savedRecipes);
  }

  /* 兼容早期版本可能使用过的字段名与存储键，尽量把旧记录找回来 */

  function pickField(source, names) {
    for (var i = 0; i < names.length; i++) {
      var value = source[names[i]];
      if (value != null && value !== '') return value;
    }
    return undefined;
  }

  function findFoodById(id) {
    for (var i = 0; i < foods.length; i++) {
      if (foods[i].id === id) return foods[i];
    }
    return null;
  }

  function adaptLegacyItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    var foodRef = pickField(raw, ['foodId', 'food', 'foodID', 'food_id', 'ingredientId']);
    var food = null;
    if (foodRef && typeof foodRef === 'object') {
      food = foodRef;
    } else if (foodRef != null) {
      food = findFoodById(String(foodRef));
    }

    var name = pickField(raw, ['name', 'foodName', 'title', 'label']) || (food && food.name);
    if (!name) return null;

    var amount = Number(pickField(raw, ['amount', 'grams', 'gram', 'weight', 'quantity', 'qty']));
    var energy = Number(pickField(raw, ['energy', 'kcal', 'energyKcal', 'calories', 'kcalPer100g', 'per100g']));
    if (!isFinite(energy) && food) energy = Number(food.energy);

    var unit = pickField(raw, ['basis', 'unit']);
    if (unit == null && food) unit = food.basis;

    return normalizeSavedItem({
      name: name,
      basis: unit === 'perServing' || unit === '份' || unit === 'serving' ? 'perServing' : 'per100g',
      energy: isFinite(energy) ? energy : 0,
      amount: isFinite(amount) ? amount : 0
    });
  }

  function adaptLegacyEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;

    var name = pickField(raw, ['name', 'title', 'recipeName']);
    if (!name) return null;

    var itemsRaw = pickField(raw, ['items', 'ingredients', 'foods', 'components']);
    if (!Array.isArray(itemsRaw)) return null;

    var items = itemsRaw.map(adaptLegacyItem).filter(Boolean);
    if (!items.length) return null;

    var servings = Number(pickField(raw, ['servings', 'portions', 'servingCount', 'pieces']));
    var created = Number(pickField(raw, ['createdAt', 'savedAt', 'time', 'timestamp', 'date']));

    return normalizeSavedRecipe({
      id: pickField(raw, ['id']),
      name: name,
      servings: isFinite(servings) && servings > 0 ? servings : 1,
      items: items,
      createdAt: isFinite(created) ? created : Date.now(),
      updatedAt: isFinite(created) ? created : Date.now()
    });
  }

  function collectLegacyRecipes() {
    var found = [];

    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key === RECIPES_KEY || key === FOODS_KEY || key === RECIPE_KEY || key === TAB_KEY) continue;
        if (!/(recipe|history|record|saved)/i.test(key)) continue;

        var value = read(key, null);
        var list = null;

        if (Array.isArray(value)) {
          list = value;
        } else if (value && typeof value === 'object') {
          if (Array.isArray(value.items)) {
            list = [value];
          } else if (Array.isArray(value.recipes)) {
            list = value.recipes;
          } else if (Array.isArray(value.entries)) {
            list = value.entries;
          } else if (Array.isArray(value.history)) {
            list = value.history;
          }
        }

        if (!list) continue;
        list.forEach(function (raw) {
          var entry = adaptLegacyEntry(raw);
          if (entry) found.push(entry);
        });
      }
    } catch (error) {
      return [];
    }

    return found;
  }

  if (!savedRecipes.length) {
    var legacyRecipes = collectLegacyRecipes();
    if (legacyRecipes.length) {
      savedRecipes = legacyRecipes;
      persistSavedRecipes();
    }
  }

  function indexOfSavedRecipe(id) {
    for (var i = 0; i < savedRecipes.length; i++) {
      if (savedRecipes[i].id === id) return i;
    }
    return -1;
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

    getSavedRecipes: function () {
      return savedRecipes.map(function (entry) {
        return {
          id: entry.id,
          name: entry.name,
          servings: entry.servings,
          items: entry.items.map(function (item) {
            return Object.assign({}, item);
          }),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        };
      }).sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
    },

    saveSavedRecipe: function (data) {
      if (!data) return null;
      var idx = data.id ? indexOfSavedRecipe(String(data.id)) : -1;
      var base = idx !== -1 ? savedRecipes[idx] : {};
      var entry = normalizeSavedRecipe(Object.assign({}, base, data, {
        id: idx !== -1 ? base.id : undefined,
        createdAt: idx !== -1 ? base.createdAt : undefined,
        updatedAt: Date.now()
      }));
      if (!entry) return null;
      if (idx !== -1) {
        savedRecipes[idx] = entry;
      } else {
        savedRecipes.push(entry);
      }
      persistSavedRecipes();
      return entry;
    },

    deleteSavedRecipe: function (id) {
      var idx = indexOfSavedRecipe(id);
      if (idx === -1) return false;
      savedRecipes.splice(idx, 1);
      persistSavedRecipes();
      return true;
    },

    getTab: function () {
      return tab === 'calc' || tab === 'recipes' ? tab : 'library';
    },

    setTab: function (next) {
      tab = next === 'calc' || next === 'recipes' ? next : 'library';
      write(TAB_KEY, tab);
    }
  };
})();
