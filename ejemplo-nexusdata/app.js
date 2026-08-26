const resources = [
  {
    type: "HTML",
    typeClass: "type-html",
    title: "Inicio del recorrido",
    description: "La interfaz principal de Atlas Local, construida sin recursos externos.",
    file: "index.html",
    tags: ["estructura", "visor"]
  },
  {
    type: "CSS",
    typeClass: "type-css",
    title: "Lenguaje visual",
    description: "Colores, tarjetas, estados y comportamiento responsive de la página.",
    file: "styles.css",
    tags: ["estilos", "responsive"]
  },
  {
    type: "JS",
    typeClass: "type-js",
    title: "Interacciones locales",
    description: "Filtro, tema claro y recorrido completado: todo ocurre en el navegador.",
    file: "app.js",
    tags: ["funciones", "interacción"]
  },
  {
    type: "JSON",
    typeClass: "type-json",
    title: "Inventario de recursos",
    description: "Datos estructurados para probar búsquedas por etiquetas y categorías.",
    file: "data/recursos.json",
    tags: ["datos", "offline"]
  },
  {
    type: "MD",
    typeClass: "type-md",
    title: "Notas de prueba",
    description: "Decisiones y palabras clave que ayudan a comprobar la indexación textual.",
    file: "docs/notas-de-prueba.md",
    tags: ["contexto", "documentación"]
  },
  {
    type: "NXD",
    typeClass: "type-nxd",
    title: "Flujo de exploración",
    description: "Diagrama importable con nodos separados para que las flechas se lean bien.",
    file: "docs/flujo-exploracion.nxd",
    tags: ["diagrama", "relaciones"]
  }
];

const resourceGrid = document.querySelector("#resource-grid");
const resourceFilter = document.querySelector("#resource-filter");
const resourceCount = document.querySelector("#resource-count");
const emptyState = document.querySelector("#empty-state");
const resetFilter = document.querySelector("#reset-filter");
const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector("#theme-label");
const exploreButton = document.querySelector("#explore-button");
const checkInButton = document.querySelector("#check-in-button");
const checkInLink = document.querySelector("#check-in-link");
const timeline = document.querySelector("#timeline");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resourceTemplate(resource, index) {
  const tags = resource.tags
    .map((tag) => `<span class="resource-tag">#${escapeHtml(tag)}</span>`)
    .join("");

  return `
    <article class="resource-card">
      <div class="resource-card__top">
        <span class="resource-type ${resource.typeClass}">${escapeHtml(resource.type)}</span>
        <span class="resource-index">0${index + 1}</span>
      </div>
      <h3>${escapeHtml(resource.title)}</h3>
      <p>${escapeHtml(resource.description)}</p>
      <div class="resource-card__meta">${escapeHtml(resource.file)}</div>
      <div class="resource-tags">${tags}</div>
    </article>
  `;
}

function renderResources(query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visibleResources = resources.filter((resource) => {
    const searchableText = [
      resource.type,
      resource.title,
      resource.description,
      resource.file,
      ...resource.tags
    ].join(" ").toLocaleLowerCase("es");

    return searchableText.includes(normalizedQuery);
  });

  resourceGrid.innerHTML = visibleResources
    .map((resource) => resourceTemplate(resource, resources.indexOf(resource)))
    .join("");
  resourceCount.textContent = `${visibleResources.length} recurso${visibleResources.length === 1 ? "" : "s"} local${visibleResources.length === 1 ? "" : "es"}`;
  emptyState.hidden = visibleResources.length > 0;
}

function getStoredTheme() {
  try {
    return window.localStorage.getItem("atlas-local-theme") || "dark";
  } catch {
    return "dark";
  }
}

function saveTheme(theme) {
  try {
    window.localStorage.setItem("atlas-local-theme", theme);
  } catch {
    // La demo sigue funcionando aunque el navegador no permita almacenamiento local.
  }
}

function setTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.dataset.theme = isLight ? "light" : "dark";
  themeToggle.setAttribute("aria-pressed", String(isLight));
  themeIcon.textContent = isLight ? "☾" : "☼";
  themeLabel.textContent = isLight ? "Oscuro" : "Claro";
}

function completeWalkthrough() {
  timeline.querySelectorAll(".timeline-item").forEach((item) => item.classList.add("is-complete"));
  checkInButton.textContent = "Recorrido completado ✓";
  checkInLink.textContent = "Demo completada ✓";
  checkInButton.classList.add("is-complete");
}

resourceFilter.addEventListener("input", (event) => renderResources(event.target.value));

resetFilter.addEventListener("click", () => {
  resourceFilter.value = "";
  renderResources();
  resourceFilter.focus();
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  setTheme(nextTheme);
  saveTheme(nextTheme);
});

exploreButton.addEventListener("click", () => {
  document.querySelector("#recursos").scrollIntoView({ behavior: "smooth" });
  window.setTimeout(() => resourceFilter.focus(), 500);
});

checkInButton.addEventListener("click", completeWalkthrough);
checkInLink.addEventListener("click", completeWalkthrough);

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== resourceFilter) {
    event.preventDefault();
    resourceFilter.focus();
  }
});

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("is-active"));
    link.classList.add("is-active");
  });
});

setTheme(getStoredTheme());
renderResources();
