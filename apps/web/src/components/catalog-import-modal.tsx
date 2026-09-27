'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FormModal } from '@/components/form-modal';
import { Button } from '@/components/ui/button';
import { apiUpload } from '@/lib/api';
import { useI18n } from '@/i18n';

export type CatalogImportPreview = {
  dryRun?: boolean;
  created: number;
  updated: number;
  skipped: number;
  createdMedicines?: number;
  createdSupplies?: number;
  updatedMedicines?: number;
  updatedSupplies?: number;
  unknownColumns?: string[];
  categoriesToCreate?: string[];
  unitsToCreate?: string[];
  previewRows?: Array<{
    row: number;
    action: 'create' | 'update' | 'skip';
    name: string;
    itemType: string;
    category: string;
    unit: string;
    sheet?: string;
    reason?: string;
    extraColumns?: Record<string, string>;
  }>;
};

type Step = 'upload' | 'preview' | 'done';

export function CatalogImportModal({
  open,
  onClose,
  defaultItemType,
  onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  defaultItemType: string;
  onCommitted: (result: CatalogImportPreview) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CatalogImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (selected: File) => {
      const formData = new FormData();
      formData.append('file', selected);
      formData.append('defaultItemType', defaultItemType);
      return apiUpload<CatalogImportPreview>('/medicines/import/preview', formData);
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep('preview');
      setError(null);
    },
    onError: (err) => setError((err as Error).message),
  });

  const commitMutation = useMutation({
    mutationFn: async (selected: File) => {
      const formData = new FormData();
      formData.append('file', selected);
      formData.append('defaultItemType', defaultItemType);
      return apiUpload<CatalogImportPreview>('/medicines/import', formData);
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep('done');
      setError(null);
      onCommitted(data);
    },
    onError: (err) => setError((err as Error).message),
  });

  const pending = previewMutation.isPending || commitMutation.isPending;

  function reset() {
    setStep('upload');
    setFile(null);
    setPreview(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  const title = useMemo(() => {
    if (step === 'upload') return t('inventory.import.stepUploadTitle');
    if (step === 'preview') return t('inventory.import.stepPreviewTitle');
    return t('inventory.import.stepDoneTitle');
  }, [step, t]);

  return (
    <FormModal open={open} title={title} onClose={handleClose} className="max-w-5xl">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        {(['upload', 'preview', 'done'] as Step[]).map((item, index) => (
          <div key={item} className="flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                step === item
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-muted-foreground/30'
              }`}
            >
              {index + 1}
            </span>
            <span className={step === item ? 'font-medium text-foreground' : ''}>
              {t(
                item === 'upload'
                  ? 'inventory.import.stepUpload'
                  : item === 'preview'
                    ? 'inventory.import.stepPreview'
                    : 'inventory.import.stepConfirm',
              )}
            </span>
            {index < 2 ? <span className="text-muted-foreground/40">—</span> : null}
          </div>
        ))}
      </div>

      {step === 'upload' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('inventory.import.uploadHint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="block w-full text-sm"
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              setError(null);
            }}
          />
          {file ? (
            <p className="text-sm">
              {t('inventory.import.selectedFile', { name: file.name })}
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!file || pending}
              onClick={() => file && previewMutation.mutate(file)}
            >
              {pending ? t('inventory.import.analyzing') : t('inventory.import.analyzePreview')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'preview' && preview ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <SummaryCard label={t('inventory.import.willCreate')} value={preview.created} />
            <SummaryCard label={t('inventory.import.willUpdate')} value={preview.updated} />
            <SummaryCard label={t('inventory.import.willSkip')} value={preview.skipped} />
            <SummaryCard
              label={t('inventory.import.newColumns')}
              value={preview.unknownColumns?.length ?? 0}
            />
          </div>

          {(preview.categoriesToCreate?.length || preview.unitsToCreate?.length) ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              {preview.categoriesToCreate?.length ? (
                <p>
                  <span className="font-medium">{t('inventory.import.categoriesToCreate')}: </span>
                  {preview.categoriesToCreate.join(' · ')}
                </p>
              ) : null}
              {preview.unitsToCreate?.length ? (
                <p className="mt-1">
                  <span className="font-medium">{t('inventory.import.unitsToCreate')}: </span>
                  {preview.unitsToCreate.join(' · ')}
                </p>
              ) : null}
            </div>
          ) : null}

          {preview.unknownColumns && preview.unknownColumns.length > 0 ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-medium">{t('inventory.import.newColumnsHint')}</p>
              <p className="mt-1 text-muted-foreground">{preview.unknownColumns.join(' · ')}</p>
            </div>
          ) : null}

          <div className="max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left">
                <tr>
                  <th className="px-2 py-2">{t('inventory.import.colRow')}</th>
                  <th className="px-2 py-2">{t('inventory.import.colAction')}</th>
                  <th className="px-2 py-2">{t('table.name')}</th>
                  <th className="px-2 py-2">{t('table.type')}</th>
                  <th className="px-2 py-2">{t('table.category')}</th>
                  <th className="px-2 py-2">{t('table.unit')}</th>
                </tr>
              </thead>
              <tbody>
                {(preview.previewRows ?? []).map((row) => (
                  <tr key={`${row.row}-${row.name}`} className="border-t">
                    <td className="px-2 py-1.5 text-muted-foreground">{row.row}</td>
                    <td className="px-2 py-1.5">
                      <ActionBadge action={row.action} />
                      {row.reason ? (
                        <div className="text-xs text-destructive">{row.reason}</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 font-medium">{row.name}</td>
                    <td className="px-2 py-1.5">{row.itemType}</td>
                    <td className="px-2 py-1.5">{row.category}</td>
                    <td className="px-2 py-1.5">{row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setStep('upload')}>
              {t('common.back')}
            </Button>
            <Button
              type="button"
              disabled={!file || pending || (preview.created === 0 && preview.updated === 0)}
              onClick={() => file && commitMutation.mutate(file)}
            >
              {pending ? t('inventory.import.committing') : t('inventory.import.confirmMerge')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'done' && preview ? (
        <div className="space-y-4">
          <p className="text-sm">{t('inventory.import.doneMessage')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <SummaryCard label={t('inventory.import.created')} value={preview.created} />
            <SummaryCard label={t('inventory.import.updated')} value={preview.updated} />
            <SummaryCard label={t('inventory.import.skipped')} value={preview.skipped} />
          </div>
          <Button type="button" onClick={handleClose}>
            {t('common.close')}
          </Button>
        </div>
      ) : null}
    </FormModal>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function ActionBadge({ action }: { action: 'create' | 'update' | 'skip' }) {
  const tone =
    action === 'create'
      ? 'bg-emerald-50 text-emerald-800'
      : action === 'update'
        ? 'bg-sky-50 text-sky-800'
        : 'bg-amber-50 text-amber-800';
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${tone}`}>
      {action}
    </span>
  );
}
