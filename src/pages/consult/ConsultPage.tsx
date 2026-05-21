import { useState, useEffect } from 'react';
import { ConsultApp } from '../../components/consult/ConsultApp';
import { PinGate } from '../../components/consult/PinGate';

const SESSION_KEY = 'abrams_consult_unlocked';

export default function ConsultPage() {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY) === 'true') setUnlocked(true);
  }, []);

  if (!unlocked) {
    return (
      <PinGate
        onUnlock={() => {
          sessionStorage.setItem(SESSION_KEY, 'true');
          setUnlocked(true);
        }}
      />
    );
  }

  return <ConsultApp />;
}
