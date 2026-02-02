import { useEffect, useState } from "react";

const STORAGE_KEY = "orchestrator_token";

export function useAuthToken(): [string, (value: string) => void] {
  const [token, setTokenState] = useState("");

  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      setTokenState(existing);
    }
  }, []);

  const setToken = (value: string) => {
    const trimmed = value.trim();
    setTokenState(trimmed);
    if (trimmed.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, trimmed);
  };

  return [token, setToken];
}
