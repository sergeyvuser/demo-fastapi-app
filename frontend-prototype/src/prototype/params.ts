import { useCallback, useEffect, useState } from 'react';

// No router in this prototype (ticket 13 says so). Search params are read and written by hand.

export type Screen = 'alerts' | 'new' | 'history';
export type Variant = 'A' | 'B' | 'C' | 'D';
export type Dataset = 'normal' | 'empty' | 'many';

export interface Params {
  screen: Screen;
  variant: Variant;
  data: Dataset;
  /** false = the socket is down and prices are frozen. */
  live: boolean;
  /** false = the unverified banner is up and the app is read-only (ticket 03). */
  verified: boolean;
}

const DEFAULTS: Params = {
  screen: 'alerts',
  variant: 'D',
  data: 'normal',
  live: true,
  verified: true,
};

function read(): Params {
  const search = new URLSearchParams(window.location.search);
  const one = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = search.get(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  };
  return {
    screen: one('screen', ['alerts', 'new', 'history'] as const, DEFAULTS.screen),
    variant: one('variant', ['A', 'B', 'C', 'D'] as const, DEFAULTS.variant),
    data: one('data', ['normal', 'empty', 'many'] as const, DEFAULTS.data),
    live: search.get('live') !== '0',
    verified: search.get('verified') !== '0',
  };
}

export function useParams(): [Params, (patch: Partial<Params>) => void] {
  const [params, setParams] = useState<Params>(read);

  useEffect(() => {
    const onPop = () => setParams(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const update = useCallback((patch: Partial<Params>) => {
    setParams((previous) => {
      const next = { ...previous, ...patch };
      const search = new URLSearchParams();
      search.set('screen', next.screen);
      if (next.screen === 'alerts') search.set('variant', next.variant);
      search.set('data', next.data);
      if (!next.live) search.set('live', '0');
      if (!next.verified) search.set('verified', '0');
      // replaceState, not pushState: flipping variants should not build a back-button history
      window.history.replaceState(null, '', `?${search.toString()}`);
      return next;
    });
  }, []);

  return [params, update];
}
