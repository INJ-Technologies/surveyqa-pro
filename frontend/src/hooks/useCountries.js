// frontend/src/hooks/useCountries.js
// Fetches active countries from the proxy_countries table.
// Use this hook everywhere countries are needed.
 
import { useState, useEffect } from 'react';
import api from '../api';
 
let _cache = null; // module-level cache so we only fetch once per session
 
export function useCountries() {
  const [countries, setCountries] = useState(_cache || []);
  const [loading,   setLoading]   = useState(!_cache);
 
  useEffect(() => {
    if (_cache) { setCountries(_cache); setLoading(false); return; }
    api.get('/proxy/countries')
      .then(res => {
        const data = res.data.countries || [];
        _cache = data;
        setCountries(data);
      })
      .catch(() => setCountries([]))
      .finally(() => setLoading(false));
  }, []);
 
  // Format for use in the existing Select component (isMulti)
  const asOptions = countries.map(c => ({
    value: c.code,
    label: `${c.code} — ${c.country}`,
  }));
 
  return { countries, asOptions, loading };
}