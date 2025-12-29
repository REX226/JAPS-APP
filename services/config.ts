
const RUNTIME_KEY = 'SENTINEL_REMOTE_DB_URL';
// ✅ HARDCODED URL to ensure connection works immediately
const DEFAULT_DB_URL = "https://japs-parivar-siren-default-rtdb.firebaseio.com";

export const getBackendUrl = (): string => {
  // 1. Env Var (Build time)
  // 2. Local Storage (Runtime override)
  // 3. Default Hardcoded (Fallback)
  const url = process.env.REACT_APP_DB_URL || localStorage.getItem(RUNTIME_KEY) || DEFAULT_DB_URL;
  return url.replace(/\/$/, ""); // Ensure no trailing slash
};

export const setBackendUrl = (url: string) => {
  if (!url) {
    localStorage.removeItem(RUNTIME_KEY);
  } else {
    // Remove trailing slash if user pasted it
    const cleanUrl = url.replace(/\/$/, "");
    localStorage.setItem(RUNTIME_KEY, cleanUrl);
  }
};

export const isCloudEnabled = (): boolean => {
  const url = getBackendUrl();
  return !!url && url.length > 0;
};
