'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useSession } from '@/features/auth/use-session';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';

interface Organization {
  id: string;
  name: string;
  code: string;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  county: string | null;
  country: string;
  currency: string;
  timezone: string;
}

interface Settings {
  defaultDueDay: number;
  receiptPrefix: string;
  leaseExpiryWarningDays: number;
}

export default function SettingsPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const canEditOrganization = can('organization.update');
  const canEditSettings = can('settings.update');

  const organization = useQuery({
    queryKey: queryKeys.organization,
    queryFn: () => api.get<Organization>('/organization'),
  });
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<Settings>('/settings'),
  });

  const [orgForm, setOrgForm] = useState({ name: '', phone: '', addressLine: '', city: '', county: '' });
  const [prefsForm, setPrefsForm] = useState({ defaultDueDay: 5, receiptPrefix: 'RCP', leaseExpiryWarningDays: 60 });

  useEffect(() => {
    if (organization.data) {
      setOrgForm({
        name: organization.data.name,
        phone: organization.data.phone ?? '',
        addressLine: organization.data.addressLine ?? '',
        city: organization.data.city ?? '',
        county: organization.data.county ?? '',
      });
    }
  }, [organization.data]);

  useEffect(() => {
    if (settings.data) {
      setPrefsForm({
        defaultDueDay: settings.data.defaultDueDay,
        receiptPrefix: settings.data.receiptPrefix,
        leaseExpiryWarningDays: settings.data.leaseExpiryWarningDays,
      });
    }
  }, [settings.data]);

  const saveOrganization = useMutation({
    mutationFn: (values: typeof orgForm) =>
      api.patch<Organization>('/organization', {
        name: values.name,
        ...(values.phone ? { phone: values.phone } : {}),
        ...(values.addressLine ? { addressLine: values.addressLine } : {}),
        ...(values.city ? { city: values.city } : {}),
        ...(values.county ? { county: values.county } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.organization });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success('Organization updated.');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save your changes.'),
  });

  const savePreferences = useMutation({
    mutationFn: (values: typeof prefsForm) => api.patch<Settings>('/settings', values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      toast.success('Preferences updated.');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save your preferences.'),
  });

  if (organization.isLoading || settings.isLoading) return <CardSkeleton count={2} />;

  if (organization.isError) {
    return (
      <ErrorState
        description={
          organization.error instanceof ApiError
            ? organization.error.message
            : 'Settings could not be loaded.'
        }
        onRetry={() => void organization.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your organization's details and the defaults new records inherit."
      />

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            Code <span className="font-mono">{organization.data?.code}</span> · currency{' '}
            {organization.data?.currency} · timezone {organization.data?.timezone}. The code appears
            on receipts and cannot be changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveOrganization.mutate(orgForm);
            }}
          >
            <FormField label="Name" htmlFor="orgName" className="sm:col-span-2">
              <Input
                value={orgForm.name}
                disabled={!canEditOrganization}
                onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })}
              />
            </FormField>
            <FormField label="Phone" htmlFor="orgPhone">
              <Input
                value={orgForm.phone}
                disabled={!canEditOrganization}
                placeholder="+254 700 000000"
                onChange={(event) => setOrgForm({ ...orgForm, phone: event.target.value })}
              />
            </FormField>
            <FormField label="City" htmlFor="orgCity">
              <Input
                value={orgForm.city}
                disabled={!canEditOrganization}
                onChange={(event) => setOrgForm({ ...orgForm, city: event.target.value })}
              />
            </FormField>
            <FormField label="County" htmlFor="orgCounty">
              <Input
                value={orgForm.county}
                disabled={!canEditOrganization}
                onChange={(event) => setOrgForm({ ...orgForm, county: event.target.value })}
              />
            </FormField>
            <FormField label="Address" htmlFor="orgAddress">
              <Input
                value={orgForm.addressLine}
                disabled={!canEditOrganization}
                onChange={(event) => setOrgForm({ ...orgForm, addressLine: event.target.value })}
              />
            </FormField>

            {canEditOrganization ? (
              <div className="sm:col-span-2">
                <Button type="submit" loading={saveOrganization.isPending}>
                  Save organization
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Only a property owner can change these details.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
          <CardDescription>
            Values new leases and receipts inherit. They take effect from Phases 3 and 4, when
            leases and receipts exist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              savePreferences.mutate(prefsForm);
            }}
          >
            <FormField
              label="Rent due day"
              htmlFor="defaultDueDay"
              hint="1-28, so every month has that date."
            >
              <Input
                type="number"
                min={1}
                max={28}
                value={prefsForm.defaultDueDay}
                disabled={!canEditSettings}
                onChange={(event) =>
                  setPrefsForm({ ...prefsForm, defaultDueDay: Number(event.target.value) })
                }
              />
            </FormField>
            <FormField label="Receipt prefix" htmlFor="receiptPrefix" hint="2-6 uppercase letters.">
              <Input
                value={prefsForm.receiptPrefix}
                disabled={!canEditSettings}
                onChange={(event) =>
                  setPrefsForm({ ...prefsForm, receiptPrefix: event.target.value.toUpperCase() })
                }
              />
            </FormField>
            <FormField
              label="Lease expiry warning"
              htmlFor="leaseExpiryWarningDays"
              hint="Days before expiry to start warning."
            >
              <Input
                type="number"
                min={1}
                max={365}
                value={prefsForm.leaseExpiryWarningDays}
                disabled={!canEditSettings}
                onChange={(event) =>
                  setPrefsForm({ ...prefsForm, leaseExpiryWarningDays: Number(event.target.value) })
                }
              />
            </FormField>

            {canEditSettings ? (
              <div className="sm:col-span-3">
                <Button type="submit" loading={savePreferences.isPending}>
                  Save defaults
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground sm:col-span-3">
                Only a property owner can change these defaults.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </>
  );
}
