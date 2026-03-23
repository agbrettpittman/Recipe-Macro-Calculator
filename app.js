// ── Recipe Macro Calculator — app.js ──

// ============================================================
// Constants
// ============================================================

const MACRO_FIELDS = [
  { key: "calories",      label: "Calories",       unit: "kcal", decimals: 0 },
  { key: "protein",       label: "Protein",        unit: "g",    decimals: 1 },
  { key: "totalFat",      label: "Total Fat",      unit: "g",    decimals: 1 },
  { key: "saturatedFat",  label: "Saturated Fat",  unit: "g",    decimals: 1 },
  { key: "transFat",      label: "Trans Fat",      unit: "g",    decimals: 1 },
  { key: "carbs",         label: "Carbohydrates",  unit: "g",    decimals: 1 },
  { key: "fiber",         label: "Fiber",          unit: "g",    decimals: 1 },
  { key: "sugar",         label: "Sugar",          unit: "g",    decimals: 1 },
  { key: "sodium",        label: "Sodium",         unit: "mg",   decimals: 1 },
  { key: "cholesterol",   label: "Cholesterol",    unit: "mg",   decimals: 1 },
];

const DB_NAME = "RecipeMacroCalcDB";
const DB_VERSION = 1;
const STORE_NAME = "recipes";

// ============================================================
// IndexedDB Layer
// ============================================================

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllRecipes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getRecipe(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecipe(recipe) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = recipe.id ? store.put(recipe) : store.add(recipe);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRecipe(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// Calculation Engine
// ============================================================

/** Returns a zeroed macro object. */
function emptyMacros() {
  const m = {};
  for (const f of MACRO_FIELDS) m[f.key] = 0;
  return m;
}

/**
 * For each ingredient, scale its per-serving macros by (amountG / servingSizeG)
 * and sum across all ingredients to get total recipe macros.
 */
function calcRecipeMacros(ingredients) {
  const total = emptyMacros();
  for (const ing of ingredients) {
    const servSize = parseFloat(ing.servingSizeG) || 0;
    const amount = parseFloat(ing.amountG) || 0;
    if (servSize <= 0 || amount <= 0) continue;
    const scale = amount / servSize;
    for (const f of MACRO_FIELDS) {
      const val = parseFloat(ing.macros[f.key]) || 0;
      total[f.key] += Math.max(0, val) * scale;
    }
  }
  return total;
}

/**
 * Given total recipe macros, compute per-serving macros.
 * servingFraction = servingSizeG / totalWeightG
 */
function calcServingMacros(recipeMacros, servingSizeG, totalWeightG) {
  const result = emptyMacros();
  if (totalWeightG <= 0 || servingSizeG <= 0) return result;
  const fraction = servingSizeG / totalWeightG;
  for (const f of MACRO_FIELDS) {
    result[f.key] = recipeMacros[f.key] * fraction;
  }
  return result;
}

/** Sum of all ingredient amountG values. */
function calcTotalWeight(ingredients) {
  let total = 0;
  for (const ing of ingredients) {
    total += Math.max(0, parseFloat(ing.amountG) || 0);
  }
  return total;
}

/** Round a number to a given number of decimal places. */
function rd(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Format a macro value for display. */
function fmtMacro(value, field) {
  const rounded = rd(value, field.decimals);
  return `${rounded}${field.unit}`;
}

// ============================================================
// UI State
// ============================================================

let currentRecipeId = null; // null = new recipe

// ============================================================
// DOM References (resolved after DOMContentLoaded)
// ============================================================
let $listView, $editorView, $recipeGrid, $recipeName, $servingSize,
    $ingredientBody, $addIngredientBtn, $saveBtn, $cancelBtn, $deleteBtn,
    $nutritionPanel, $recipeTotals, $newRecipeBtn, $customServingToggle,
    $servingSizeHint;

function cacheDom() {
  $listView        = document.getElementById("recipe-list-view");
  $editorView      = document.getElementById("recipe-editor-view");
  $recipeGrid      = document.getElementById("recipe-grid");
  $recipeName      = document.getElementById("recipe-name");
  $servingSize     = document.getElementById("serving-size");
  $ingredientBody  = document.getElementById("ingredient-body");
  $addIngredientBtn = document.getElementById("add-ingredient-btn");
  $saveBtn         = document.getElementById("save-btn");
  $cancelBtn       = document.getElementById("cancel-btn");
  $deleteBtn       = document.getElementById("delete-btn");
  $nutritionPanel  = document.getElementById("nutrition-panel");
  $recipeTotals    = document.getElementById("recipe-totals");
  $newRecipeBtn    = document.getElementById("new-recipe-btn");
  $customServingToggle = document.getElementById("custom-serving-toggle");
  $servingSizeHint = document.getElementById("serving-size-hint");
}

// ============================================================
// Rendering — Recipe List
// ============================================================

async function showRecipeList() {
  currentRecipeId = null;
  $listView.style.display = "block";
  $editorView.style.display = "none";

  const recipes = await getAllRecipes();
  if (recipes.length === 0) {
    $recipeGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🍽️</div>
        <p>No recipes yet</p>
        <button class="btn btn-primary" onclick="openEditor(null)">Create Your First Recipe</button>
      </div>`;
    return;
  }

  $recipeGrid.innerHTML = recipes.map(r => {
    const totalWeight = calcTotalWeight(r.ingredients);
    const recipeMacros = calcRecipeMacros(r.ingredients);
    const hasCustom = r.customServing !== false && r.servingSizeG > 0;
    const effectiveServing = hasCustom ? r.servingSizeG : totalWeight;
    const servMacros = calcServingMacros(recipeMacros, effectiveServing, totalWeight);
    const numServings = totalWeight > 0 && effectiveServing > 0
      ? rd(totalWeight / effectiveServing, 1)
      : 0;

    const calField = MACRO_FIELDS[0];
    const protField = MACRO_FIELDS[1];
    const fatField = MACRO_FIELDS[2];
    const carbField = MACRO_FIELDS[5];

    return `
      <div class="recipe-card" data-id="${r.id}">
        <h3>${escHtml(r.name || "Untitled Recipe")}</h3>
        <div class="card-meta">${r.ingredients.length} ingredient${r.ingredients.length !== 1 ? "s" : ""} · ${rd(totalWeight, 0)}g total · ${numServings} serving${numServings !== 1 ? "s" : ""}</div>
        <div class="card-macros">
          <div class="macro-item"><span class="macro-label">${calField.label}</span><span class="macro-value">${fmtMacro(servMacros.calories, calField)}</span></div>
          <div class="macro-item"><span class="macro-label">${protField.label}</span><span class="macro-value">${fmtMacro(servMacros.protein, protField)}</span></div>
          <div class="macro-item"><span class="macro-label">${fatField.label}</span><span class="macro-value">${fmtMacro(servMacros.totalFat, fatField)}</span></div>
          <div class="macro-item"><span class="macro-label">${carbField.label}</span><span class="macro-value">${fmtMacro(servMacros.carbs, carbField)}</span></div>
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm clone-recipe-btn" data-id="${r.id}" title="Clone recipe">📋 Clone</button>
        </div>
      </div>`;
  }).join("");

  // Attach click handlers
  $recipeGrid.querySelectorAll(".recipe-card").forEach(card => {
    card.addEventListener("click", (e) => {
      // Don't open editor when clicking the clone button
      if (e.target.closest(".clone-recipe-btn")) return;
      openEditor(Number(card.dataset.id));
    });
  });

  // Attach clone handlers
  $recipeGrid.querySelectorAll(".clone-recipe-btn").forEach(btn => {
    btn.addEventListener("click", () => cloneRecipe(Number(btn.dataset.id)));
  });
}

// ============================================================
// Rendering — Editor
// ============================================================

async function openEditor(id) {
  currentRecipeId = id;
  $listView.style.display = "none";
  $editorView.style.display = "block";

  if (id) {
    const recipe = await getRecipe(id);
    $recipeName.value = recipe.name || "";
    const hasCustomServing = recipe.customServing !== false;
    $customServingToggle.checked = hasCustomServing;
    $servingSize.value = hasCustomServing ? (recipe.servingSizeG || "") : "";
    $servingSize.disabled = !hasCustomServing;
    $servingSizeHint.style.display = hasCustomServing ? "none" : "block";
    $deleteBtn.classList.remove("hidden");
    renderIngredientRows(recipe.ingredients);
  } else {
    $recipeName.value = "";
    $customServingToggle.checked = false;
    $servingSize.value = "";
    $servingSize.disabled = true;
    $servingSizeHint.style.display = "block";
    $deleteBtn.classList.add("hidden");
    renderIngredientRows([blankIngredient()]);
  }

  updateNutritionPanel();
}

function blankIngredient() {
  return {
    name: "",
    servingSizeG: "",
    amountG: "",
    macros: emptyMacros(),
  };
}

function renderIngredientRows(ingredients) {
  $ingredientBody.innerHTML = "";
  ingredients.forEach((ing, idx) => {
    $ingredientBody.appendChild(createIngredientRow(ing, idx));
  });
}

function createIngredientRow(ing, idx) {
  const tr = document.createElement("tr");
  tr.dataset.index = idx;

  // Name cell
  let html = `<td class="col-name"><input type="text" value="${escAttr(ing.name)}" data-field="name" placeholder="e.g. Chicken Breast"></td>`;

  // Serving size cell
  html += `<td class="col-macro"><input type="number" value="${escAttr(ing.servingSizeG)}" data-field="servingSizeG" min="0" step="any" placeholder="g"></td>`;

  // Amount cell
  html += `<td class="col-macro"><input type="number" value="${escAttr(ing.amountG)}" data-field="amountG" min="0" step="any" placeholder="g"></td>`;

  // Macro cells
  for (const f of MACRO_FIELDS) {
    const val = ing.macros[f.key] ?? "";
    html += `<td class="col-macro"><input type="number" value="${escAttr(val)}" data-macro="${f.key}" min="0" step="any" placeholder="0"></td>`;
  }

  // Remove button cell
  html += `<td class="col-action"><button class="btn-icon remove-ingredient-btn" title="Remove ingredient">✕</button></td>`;

  tr.innerHTML = html;

  // Attach listeners: any input change triggers recalculation
  tr.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", updateNutritionPanel);
  });

  // Attach remove handler
  tr.querySelector(".remove-ingredient-btn").addEventListener("click", () => {
    tr.remove();
    reindexRows();
    updateNutritionPanel();
  });

  return tr;
}

function reindexRows() {
  $ingredientBody.querySelectorAll("tr").forEach((tr, i) => {
    tr.dataset.index = i;
  });
}

function addIngredientRow() {
  const idx = $ingredientBody.children.length;
  $ingredientBody.appendChild(createIngredientRow(blankIngredient(), idx));
  // Focus the name input of the new row
  const lastRow = $ingredientBody.lastElementChild;
  const nameInput = lastRow.querySelector('input[data-field="name"]');
  if (nameInput) nameInput.focus();
}

// ============================================================
// Read ingredient data from the DOM
// ============================================================

function readIngredientsFromDOM() {
  const rows = $ingredientBody.querySelectorAll("tr");
  const ingredients = [];
  rows.forEach(row => {
    const ing = {
      name: row.querySelector('[data-field="name"]').value.trim(),
      servingSizeG: row.querySelector('[data-field="servingSizeG"]').value,
      amountG: row.querySelector('[data-field="amountG"]').value,
      macros: {},
    };
    for (const f of MACRO_FIELDS) {
      ing.macros[f.key] = row.querySelector(`[data-macro="${f.key}"]`).value;
    }
    ingredients.push(ing);
  });
  return ingredients;
}

// ============================================================
// Nutrition Panel Update (live recalculation)
// ============================================================

function updateNutritionPanel() {
  const ingredients = readIngredientsFromDOM();
  const totalWeight = calcTotalWeight(ingredients);
  const useCustom = $customServingToggle.checked;
  const servingSizeG = useCustom ? (parseFloat($servingSize.value) || 0) : totalWeight;
  const recipeMacros = calcRecipeMacros(ingredients);
  const servingMacros = calcServingMacros(recipeMacros, servingSizeG, totalWeight);
  const numServings = totalWeight > 0 && servingSizeG > 0
    ? rd(totalWeight / servingSizeG, 1)
    : 0;

  // Build nutrition-facts panel HTML
  const calField = MACRO_FIELDS[0];
  let panelHtml = `
    <h3>Nutrition Facts</h3>
    <div class="serving-info">
      Serving Size ${rd(servingSizeG, 0)}g<br>
      <small>${numServings} servings per recipe</small>
    </div>
    <div class="calories-row">
      <span class="cal-label">Calories</span>
      <span class="cal-value">${rd(servingMacros.calories, calField.decimals)}</span>
    </div>`;

  // Macro rows (skip calories, it's shown above)
  const rows = [
    { key: "totalFat",     label: "Total Fat",     sub: false, thick: false },
    { key: "saturatedFat", label: "Saturated Fat", sub: true,  thick: false },
    { key: "transFat",     label: "Trans Fat",     sub: true,  thick: false },
    { key: "cholesterol",  label: "Cholesterol",   sub: false, thick: false },
    { key: "sodium",       label: "Sodium",        sub: false, thick: false },
    { key: "carbs",        label: "Total Carbs",   sub: false, thick: false },
    { key: "fiber",        label: "Dietary Fiber",  sub: true,  thick: false },
    { key: "sugar",        label: "Total Sugars",   sub: true,  thick: false },
    { key: "protein",      label: "Protein",        sub: false, thick: true  },
  ];

  for (const r of rows) {
    const field = MACRO_FIELDS.find(f => f.key === r.key);
    const classes = ["macro-row"];
    if (r.sub) classes.push("sub");
    if (r.thick) classes.push("thick-border");
    panelHtml += `
      <div class="${classes.join(" ")}">
        <span class="macro-name">${r.label}</span>
        <span class="macro-val">${fmtMacro(servingMacros[r.key], field)}</span>
      </div>`;
  }

  $nutritionPanel.innerHTML = panelHtml;

  // Build recipe totals HTML
  let totalsHtml = `<h3>Full Recipe Totals</h3>`;
  totalsHtml += `
    <div class="total-item highlight">
      <span class="total-label">Total Weight</span>
      <span class="total-value">${rd(totalWeight, 1)}g</span>
    </div>`;

  for (const f of MACRO_FIELDS) {
    totalsHtml += `
      <div class="total-item">
        <span class="total-label">${f.label}</span>
        <span class="total-value">${fmtMacro(recipeMacros[f.key], f)}</span>
      </div>`;
  }

  $recipeTotals.innerHTML = totalsHtml;
}

// ============================================================
// Save / Delete
// ============================================================

async function handleSave() {
  const name = $recipeName.value.trim();
  if (!name) {
    $recipeName.focus();
    $recipeName.style.borderColor = "var(--color-danger)";
    setTimeout(() => $recipeName.style.borderColor = "", 2000);
    return;
  }

  const recipe = {
    name,
    customServing: $customServingToggle.checked,
    servingSizeG: $customServingToggle.checked
      ? (parseFloat($servingSize.value) || 0)
      : 0,
    ingredients: readIngredientsFromDOM(),
  };

  if (currentRecipeId) {
    recipe.id = currentRecipeId;
  }

  await saveRecipe(recipe);
  showRecipeList();
}

async function cloneRecipe(id) {
  const original = await getRecipe(id);
  if (!original) return;
  const clone = {
    name: original.name + " (Copy)",
    customServing: original.customServing !== false,
    servingSizeG: original.servingSizeG,
    ingredients: JSON.parse(JSON.stringify(original.ingredients)),
  };
  await saveRecipe(clone);
  showRecipeList();
}

async function handleDelete() {
  if (!currentRecipeId) return;
  const confirmed = await showConfirm("Delete this recipe? This cannot be undone.");
  if (!confirmed) return;
  await deleteRecipe(currentRecipeId);
  showRecipeList();
}

function handleCancel() {
  showRecipeList();
}

// ============================================================
// Confirm Dialog
// ============================================================

function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <p>${escHtml(message)}</p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" id="confirm-no">Cancel</button>
          <button class="btn btn-danger" id="confirm-yes">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector("#confirm-yes").addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector("#confirm-no").addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

// ============================================================
// Utilities
// ============================================================

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ============================================================
// Initialization
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();

  // Event listeners
  $newRecipeBtn.addEventListener("click", () => openEditor(null));
  $addIngredientBtn.addEventListener("click", addIngredientRow);
  $saveBtn.addEventListener("click", handleSave);
  $cancelBtn.addEventListener("click", handleCancel);
  $deleteBtn.addEventListener("click", handleDelete);
  $servingSize.addEventListener("input", updateNutritionPanel);
  $customServingToggle.addEventListener("change", () => {
    const checked = $customServingToggle.checked;
    $servingSize.disabled = !checked;
    $servingSizeHint.style.display = checked ? "none" : "block";
    if (!checked) $servingSize.value = "";
    updateNutritionPanel();
  });

  // Initial load
  showRecipeList();
});
