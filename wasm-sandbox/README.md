# Current state of things

from Joey:

I spent most of the afternoon yesterday trying to get node.js code running in the browser, via WebAssembly, but no luck (so far).. so I'm putting this on the back-burner for now to focus on evaluating Tauri vs Electron. What I tried so far (will push up shortly my hacky/spaghetti code to a branch in archesta/prototypes ):

- [`@wasmer/sdk`](https://github.com/wasmerio/wasmer-js/tree/main) -- seems like you can only run "packages" from [Wasmer's registry](https://wasmer.io/search?type=PACKAGE)?
- [`javy`](https://github.com/bytecodealliance/javy) -- this seems interesting, this was a Shopify project which is responsible for the node-javascript -> .wasm compliation portion
  - I was able to compile node.js code to .wasm but it was quite late and I didn't succesfully get that node.js .wasm binary to run in my browser (something about missing node.js objects in the browser, like Buffer -- maybe with appropriate polyfills + vite setup could get this working?)
- [webcontainers](https://webcontainers.io/guides/introduction) -- StackBlitz basically "rewrote node" such that it could run in a browser environment, but it feels like they've ripped away their open-source portion? (see [this repo](https://github.com/stackblitz/webcontainer-api-starter/tree/main))
- [OpenWebContainer](https://github.com/thecodacus/OpenWebContainer) -- this could maybe be an option?

there was also an [interesting GH issue](https://github.com/nodejs/help/issues/3774) in the node GH repo -- basically people were asking about "I want to compile node.js to WASM" and the `@webcontainer/api` came up and people tried "deobfuscating" their source code to figure out how to do this... sounds complicated
