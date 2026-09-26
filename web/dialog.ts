import dialogHtml from "./dialog.html?raw";

function init() {
  document.body.insertAdjacentHTML('beforeend', dialogHtml);
  const modulePath = new URL(import.meta.url).pathname;
  document.querySelector("#moduleUrl")!.textContent = modulePath;
}

export function showDialogImpl() {
  const dialog = document.querySelector<HTMLDialogElement>("#demoDialog");
  dialog!.showModal();
}

init();
