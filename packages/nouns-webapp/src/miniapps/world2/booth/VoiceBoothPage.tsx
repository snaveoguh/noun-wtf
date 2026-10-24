// /world/voice: the Voice Booth on its own page (a NounOS window like every
// other page), for recording without loading the 3D world.

import VoiceBooth from './VoiceBooth';

export default function VoiceBoothPage() {
  return (
    <div
      className="flex min-h-[calc(100vh-160px)] w-full justify-center bg-[#0a0c14] px-4 py-5"
      style={{ fontFamily: 'system-ui, sans-serif' }}
    >
      <VoiceBooth />
    </div>
  );
}
