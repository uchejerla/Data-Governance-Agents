// The application version reported by `/api/version` and `/api/health`.
//
// It lives here rather than being imported from `package.json`: the Worker bundle
// is not a place to ship the dependency list, and JSON imports need a compiler
// option the Worker build does not otherwise use. Bump this with the package
// version on release — `/api/version` is the answer an operator gets when they ask
// an install what it is running.
export const APP_VERSION = '0.1.0';
