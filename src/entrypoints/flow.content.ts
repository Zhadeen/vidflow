export default defineContentScript({
  matches: ['https://flow.google.com/*', 'https://labs.google/fx/*'],
  main() {
    // Flow automation arrives in a later task.
  },
});
