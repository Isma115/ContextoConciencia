const SECTION_ICONS = Object.freeze({
  search: '<circle cx="13.5" cy="13.5" r="6.8"></circle><path d="m18.6 18.6 5.1 5.1"></path><path d="M8.5 5.2H5.2v3.3"></path>',
  recent: '<circle cx="16" cy="16" r="9"></circle><path d="M16 11v5l3.7 2.2"></path><path d="M8.5 5.7H5v3.5"></path><path d="M5 9.2A11.7 11.7 0 0 1 25.8 13"></path>',
  favorite: '<path d="m16 4.5 3.5 7.1 7.8 1.1-5.6 5.5 1.3 7.8-7-3.7-7 3.7 1.3-7.8-5.6-5.5 7.8-1.1z"></path>',
  html: '<rect x="4.5" y="6" width="23" height="20" rx="2"></rect><path d="M4.5 11h23"></path><path d="M9 8.5h.01M13 8.5h.01M17 8.5h.01"></path><path d="m12 16-3 3 3 3M20 16l3 3-3 3M18 15l-4 8"></path>',
  diagrams: '<circle cx="8" cy="9" r="3"></circle><circle cx="24" cy="9" r="3"></circle><circle cx="16" cy="24" r="3"></circle><path d="m10.7 10.3 3.7 10.8M21.3 10.3l-3.7 10.8M11 9h10"></path>',
  code: '<path d="m12 7-7 9 7 9"></path><path d="m20 7 7 9-7 9"></path><path d="m17 5-2 22"></path>',
  sources: '<path d="M4.5 9.5h8l2.2-3h12.8v19H4.5z"></path><path d="M4.5 10.5h23"></path><path d="M16 14.5v6M13 17.5h6"></path>',
  default: '<path d="M16 4v24M4 16h24"></path><circle cx="16" cy="16" r="9"></circle>'
});

export function sectionIconMarkup(name = 'default') {
  const key = Object.prototype.hasOwnProperty.call(SECTION_ICONS, name) ? name : 'default';
  return `<span class="section-decoration section-decoration-${key}" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false">${SECTION_ICONS[key]}</svg></span>`;
}
