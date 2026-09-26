(window as any).showDialog = async function() {
  const module = await import("./dialog.ts");
  module.showDialogImpl();
};