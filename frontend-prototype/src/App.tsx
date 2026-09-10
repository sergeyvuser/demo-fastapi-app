import { useEffect, useRef, useState } from 'react';
import { ALERTS, MANY_ALERTS, TRIGGERS, type Trigger } from './fake/domain';
import { useTicker } from './fake/useTicker';
import { PrototypeBar } from './prototype/PrototypeBar';
import { useParams } from './prototype/params';
import { CreateAlert } from './screens/CreateAlert';
import { History } from './screens/History';
import { VariantA } from './screens/alerts/VariantA';
import { VariantB } from './screens/alerts/VariantB';
import { VariantC } from './screens/alerts/VariantC';
import { VariantD } from './screens/alerts/VariantD';
import { Shell } from './shell/Shell';

export function App() {
  const [params, update] = useParams();
  const quotes = useTicker(params.live);

  const alerts = params.data === 'empty' ? [] : params.data === 'many' ? MANY_ALERTS : ALERTS;
  const baseTriggers = params.data === 'empty' ? [] : TRIGGERS;

  // A Trigger arriving while the screen is open — ticket 07 prepends it into the feed and
  // invalidates the Alerts list. Here it is just a timer, so each variant can be judged on what it
  // does when one lands.
  const [arrived, setArrived] = useState<Trigger[]>([]);
  useEffect(() => {
    setArrived([]);
  }, [params.data]);
  // quotes change four times a second; keeping them out of the effect's deps stops the timer being
  // torn down and rebuilt on every Tick
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  useEffect(() => {
    if (!params.live || alerts.length === 0) return;
    const id = setInterval(() => {
      const candidates = alerts.filter((alert) => alert.state === 'active');
      if (candidates.length === 0) return;
      const alert = candidates[Math.floor(Math.random() * candidates.length)];
      const price = quotesRef.current[alert.symbol]?.price ?? alert.threshold;
      setArrived((previous) => [
        {
          id: `live-${Date.now()}`,
          alert_id: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          threshold: alert.threshold,
          price,
          delivery: 'no_chat',
          created_at: new Date().toISOString(),
        },
        ...previous,
      ]);
    }, 20_000);
    return () => clearInterval(id);
  }, [params.live, alerts]);

  const triggers = [...arrived, ...baseTriggers];
  const showTicker = !(params.screen === 'alerts' && params.variant === 'C');

  // No router here (ticket 13 said none), so the screens navigate by callback.
  const goNew = () => update({ screen: 'new' });
  const goHistory = () => update({ screen: 'history' });
  const goAlerts = () => update({ screen: 'alerts' });

  return (
    <>
      <Shell params={params} update={update} quotes={quotes} showTicker={showTicker}>
        {params.screen === 'alerts' && params.variant === 'D' && (
          <VariantD
            alerts={alerts}
            quotes={quotes}
            triggers={triggers}
            live={params.live}
            onNew={goNew}
            onHistory={goHistory}
          />
        )}
        {params.screen === 'alerts' && params.variant === 'A' && (
          <VariantA alerts={alerts} quotes={quotes} live={params.live} onNew={goNew} />
        )}
        {params.screen === 'alerts' && params.variant === 'B' && (
          <VariantB
            alerts={alerts}
            quotes={quotes}
            triggers={triggers}
            live={params.live}
            onNew={goNew}
            onHistory={goHistory}
          />
        )}
        {params.screen === 'alerts' && params.variant === 'C' && (
          <VariantC alerts={alerts} quotes={quotes} live={params.live} onNew={goNew} />
        )}
        {params.screen === 'new' && (
          <CreateAlert quotes={quotes} verified={params.verified} onCancel={goAlerts} />
        )}
        {params.screen === 'history' && <History triggers={triggers} />}
      </Shell>
      <PrototypeBar params={params} update={update} />
    </>
  );
}
