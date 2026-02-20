import { useCallback, useState } from 'react';

import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  getDefaultSubgraphUrl,
  getSubgraphUrl,
  hasCustomSubgraphUrl,
  resetSubgraphUrl,
  setSubgraphUrl,
  testSubgraphUrl,
} from '@/lib/subgraphSettings';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

const SubgraphSettings: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(getSubgraphUrl());
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testResult, setTestResult] = useState<string>('');
  const [isCustom, setIsCustom] = useState(hasCustomSubgraphUrl());

  const handleOpen = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setUrl(getSubgraphUrl());
      setIsCustom(hasCustomSubgraphUrl());
      setTestStatus('idle');
      setTestResult('');
    }
    setOpen(isOpen);
  }, []);

  const handleTest = useCallback(async () => {
    if (!url.trim()) return;
    setTestStatus('testing');
    setTestResult('');

    const result = await testSubgraphUrl(url.trim());
    if (result.ok) {
      setTestStatus('success');
      setTestResult(`Connected! Latency: ${Math.round(result.latency)}ms`);
    } else {
      setTestStatus('error');
      setTestResult(result.error ?? 'Connection failed');
    }
  }, [url]);

  const handleSave = useCallback(() => {
    if (!url.trim()) return;
    setSubgraphUrl(url.trim());
    setIsCustom(true);
    // Reload the page to reinitialize Apollo client with new URL
    window.location.reload();
  }, [url]);

  const handleReset = useCallback(() => {
    resetSubgraphUrl();
    setUrl(getDefaultSubgraphUrl());
    setIsCustom(false);
    setTestStatus('idle');
    setTestResult('');
    // Reload to reinitialize with default
    window.location.reload();
  }, []);

  const defaultUrl = getDefaultSubgraphUrl();
  const isModified = url.trim() !== defaultUrl;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <button
          className="relative flex items-center justify-center rounded-md p-2 opacity-60 transition-opacity hover:opacity-100"
          title="Subgraph Settings"
        >
          <Settings className="h-5 w-5" />
          {isCustom && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-green-500" />
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Subgraph Settings</DialogTitle>
          <DialogDescription>
            Point noun.wtf at your own Ponder/subgraph endpoint. The default endpoint is our hosted
            Ponder API.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <label className="text-sm font-medium">GraphQL Endpoint URL</label>
          <Input
            value={url}
            onChange={e => {
              setUrl(e.target.value);
              setTestStatus('idle');
              setTestResult('');
            }}
            placeholder="https://your-ponder.example.com"
            className="!normal-case font-mono text-xs"
          />
          {isCustom && !isModified && (
            <p className="text-xs text-green-600">Using custom endpoint</p>
          )}
          {!isCustom && !isModified && (
            <p className="text-xs text-muted-foreground">Using default endpoint</p>
          )}

          {/* Test result */}
          {testStatus === 'testing' && (
            <p className="text-xs text-muted-foreground">Testing connection...</p>
          )}
          {testStatus === 'success' && <p className="text-xs text-green-600">{testResult}</p>}
          {testStatus === 'error' && <p className="text-xs text-red-600">{testResult}</p>}

          {/* Default URL reference */}
          <div className="rounded-md bg-muted p-2">
            <p className="text-xs text-muted-foreground">
              Default: <span className="font-mono">{defaultUrl || '(not set)'}</span>
            </p>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <div className="flex gap-2">
            {isCustom && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                Reset to Default
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={!url.trim()}>
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!url.trim() || (!isModified && isCustom)}
            >
              Save & Reload
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SubgraphSettings;
