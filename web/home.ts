async function showDialog() {
  const module = await import("./dialog.ts");
  module.showDialogImpl();
}

function init() {
  const link = document.querySelector("#lazyLoadLink");
  link!.addEventListener("click", (event) => {
    event.preventDefault();
    showDialog();
  });
}

init();