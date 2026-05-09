import { FC, useCallback, useMemo, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { generateDreamId, saveDreamToStorage } from '@/lib/dreamStorage';
import { traitName } from '@/lib/traitName';
import { INounSeed } from '@/wrappers/nounToken';

const DreamCreatePage: FC = () => {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [seed, setSeed] = useState<INounSeed>({
    background: 0,
    body: Math.floor(Math.random() * ImageData.images.bodies.length),
    accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
    head: Math.floor(Math.random() * ImageData.images.heads.length),
    glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
  });

  const svgUri = useMemo(() => {
    try {
      const { parts, background } = getNounData(seed);
      const svg = buildSVG(parts, ImageData.palette, background);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } catch {
      return '';
    }
  }, [seed]);

  const randomize = useCallback(() => {
    setSeed({
      background: Math.floor(Math.random() * ImageData.bgcolors.length),
      body: Math.floor(Math.random() * ImageData.images.bodies.length),
      accessory: Math.floor(Math.random() * ImageData.images.accessories.length),
      head: Math.floor(Math.random() * ImageData.images.heads.length),
      glasses: Math.floor(Math.random() * ImageData.images.glasses.length),
    });
  }, []);

  const handleSubmit = useCallback(() => {
    saveDreamToStorage({
      id: generateDreamId(),
      title: title.trim(),
      description: description.trim(),
      seed,
      createdAt: Date.now(),
      status: 'draft',
    });
    navigate('/dreams');
  }, [navigate, title, description, seed]);

  const traitOptions = useMemo(
    () => ({
      heads: Array.from({ length: ImageData.images.heads.length }, (_, i) => ({
        index: i,
        name: traitName('head', i),
      })),
      bodies: Array.from({ length: ImageData.images.bodies.length }, (_, i) => ({
        index: i,
        name: traitName('body', i),
      })),
      accessories: Array.from({ length: ImageData.images.accessories.length }, (_, i) => ({
        index: i,
        name: traitName('accessory', i),
      })),
      glasses: Array.from({ length: ImageData.images.glasses.length }, (_, i) => ({
        index: i,
        name: traitName('glasses', i),
      })),
    }),
    [],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-4xl font-bold">Create a Dream</h1>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Preview */}
        <div className="flex-shrink-0">
          <div
            className="rounded-2xl p-6"
            style={{ backgroundColor: `#${ImageData.bgcolors[seed.background]}` }}
          >
            {svgUri && (
              <img
                src={svgUri}
                alt="Dream preview"
                className="h-64 w-64"
                style={{ imageRendering: 'pixelated' }}
              />
            )}
          </div>
          <Button variant="outline" onClick={randomize} className="mt-3 w-full">
            Randomize
          </Button>
        </div>

        {/* Form */}
        <div className="flex-1 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-bold">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Name your dream noun..."
              className="border-border w-full rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-bold">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What inspired this design?"
              rows={3}
              className="border-border w-full rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          {/* Trait selectors */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold">Choose Traits</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Background</label>
                <select
                  value={seed.background}
                  onChange={e => setSeed(s => ({ ...s, background: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {ImageData.bgcolors.map((_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'Cool' : 'Warm'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Head</label>
                <select
                  value={seed.head}
                  onChange={e => setSeed(s => ({ ...s, head: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.heads.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Body</label>
                <select
                  value={seed.body}
                  onChange={e => setSeed(s => ({ ...s, body: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.bodies.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Accessory</label>
                <select
                  value={seed.accessory}
                  onChange={e => setSeed(s => ({ ...s, accessory: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.accessories.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-gray-500">Noggles</label>
                <select
                  value={seed.glasses}
                  onChange={e => setSeed(s => ({ ...s, glasses: Number(e.target.value) }))}
                  className="border-border w-full rounded-lg border px-3 py-1.5 text-sm"
                >
                  {traitOptions.glasses.map(t => (
                    <option key={t.index} value={t.index}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="w-full"
            size="lg"
          >
            Submit Dream
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DreamCreatePage;
