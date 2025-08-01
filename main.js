const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');

function createWindow () {
  const win = new BrowserWindow({
    width: 800,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function extractRecipe(url) {
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Try schema.org Recipe
  let recipe = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const arr = Array.isArray(json) ? json : [json];
      for (const entry of arr) if (entry["@type"] === "Recipe") recipe = entry;
    } catch (e) {}
  });

  if (!recipe.name) recipe.name = $("h1").first().text().trim();
  if (!recipe.recipeIngredient)
    recipe.recipeIngredient = $("ul,ol").first().find("li").map((_, li) => $(li).text().trim()).get();
  if (!recipe.recipeInstructions)
    recipe.recipeInstructions = $("p").map((_, p) => $(p).text().trim()).get();

  return {
    name: recipe.name || "Untitled",
    ingredients: recipe.recipeIngredient || [],
    instructions:
      Array.isArray(recipe.recipeInstructions)
        ? recipe.recipeInstructions.map(i => (typeof i === "string" ? i : i.text || "")).filter(Boolean)
        : typeof recipe.recipeInstructions === "string"
        ? [recipe.recipeInstructions]
        : [],
    url
  };
}

ipcMain.handle('export-recipes', async (event, urls) => {
  const recipes = [];
  for (const url of urls) {
    try { recipes.push(await extractRecipe(url)); }
    catch (e) { recipes.push({ name: "Failed to fetch", ingredients: [], instructions: [], url }); }
  }

  const doc = new Document({
    sections: [
      {
        children: recipes.flatMap(recipe => [
          new Paragraph({ text: recipe.name, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Source: ${recipe.url}` }),
          new Paragraph({ text: "Ingredients:", heading: HeadingLevel.HEADING_2 }),
          ...recipe.ingredients.map(ing => new Paragraph({ text: `• ${ing}` })),
          new Paragraph({ text: "Instructions:", heading: HeadingLevel.HEADING_2 }),
          ...recipe.instructions.map((ins, i) => new Paragraph({ text: `${i + 1}. ${ins}` })),
          new Paragraph({ text: "" }),
        ]),
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);

  // Let user choose save location
  const { filePath } = await dialog.showSaveDialog({ defaultPath: "recipes.docx" });
  if (filePath) fs.writeFileSync(filePath, buffer);
  return filePath || null;
});
