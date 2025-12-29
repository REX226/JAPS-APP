
const RUNTIME_KEY = 'SENTINEL_REMOTE_DB_URL';

export const getBackendUrl = (): string => {
  // Check build-time env var first, then runtime local storage override
  const url = process.env.REACT_APP_DB_URL || localStorage.getItem(RUNTIME_KEY) || '';
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
