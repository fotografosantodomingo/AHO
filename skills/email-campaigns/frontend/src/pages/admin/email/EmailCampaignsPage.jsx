import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
	Loader2,
	RefreshCw,
	AlertTriangle,
	ArrowLeft,
	Send,
	Plus,
	Eye,
	Copy,
	Trash2,
	Inbox,
	X,
	ChevronLeft,
	ChevronRight,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 25;

const formatDateTime = (iso) => {
	if (!iso) return '—';
	try {
		return new Date(iso).toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	} catch {
		return '—';
	}
};

const statusBadgeClass = (status) =>
	({
		draft: 'bg-stone-700/40 text-stone-300 border-stone-600',
		sending: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
		sent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
		failed: 'bg-red-500/15 text-red-300 border-red-500/40',
	})[status] || 'bg-card border-foreground/10 text-foreground/60';

const summarizeSegmentFilter = (sf) => {
	if (!sf || typeof sf !== 'object') return '—';
	const parts = [];
	if (Array.isArray(sf.segments) && sf.segments.length) parts.push(sf.segments.join('/'));
	if (Array.isArray(sf.tags) && sf.tags.length) parts.push(`tags:${sf.tags.join(',')}`);
	if (sf.status) parts.push(`status:${sf.status}`);
	return parts.join(' · ') || '—';
};

const EmailCampaignsPage = () => {
	const { t } = useTranslation('adminEmailCampaigns');
	const navigate = useNavigate();
	const [rows, setRows] = useState([]);
	const [totalCount, setTotalCount] = useState(0);
	const [page, setPage] = useState(0);
	const [statusFilter, setStatusFilter] = useState('all');
	const [fromDate, setFromDate] = useState('');
	const [toDate, setToDate] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [actingId, setActingId] = useState(null);
	const [drawer, setDrawer] = useState(null); // { campaign, stats }

	useEffect(() => {
		setPage(0);
	}, [statusFilter, fromDate, toDate]);

	const loadPage = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const from = page * PAGE_SIZE;
			const to = from + PAGE_SIZE - 1;
			let q = supabase
				.from('email_campaigns')
				.select(
					'id, name, subject, segment_filter, recipients_count, status, sent_at, created_at, updated_at',
					{ count: 'exact' },
				)
				.order('created_at', { ascending: false })
				.range(from, to);
			if (statusFilter !== 'all') q = q.eq('status', statusFilter);
			if (fromDate) q = q.gte('created_at', new Date(fromDate).toISOString());
			if (toDate) {
				const t = new Date(toDate);
				t.setDate(t.getDate() + 1);
				q = q.lt('created_at', t.toISOString());
			}
			const { data, error: e, count } = await q;
			if (e) throw e;
			setRows(data || []);
			setTotalCount(count || 0);
		} catch (err) {
			setError(err.message || t('toast.loadFailed'));
			setRows([]);
			setTotalCount(0);
		} finally {
			setLoading(false);
		}
	}, [page, statusFilter, fromDate, toDate, t]);

	useEffect(() => {
		loadPage();
	}, [loadPage]);

	const totalPages = useMemo(
		() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
		[totalCount],
	);

	const openDrawer = async (row) => {
		setDrawer({ campaign: row, stats: null, loading: true });
		try {
			const { data, error: e } = await supabase
				.from('email_logs')
				.select('status')
				.eq('campaign_id', row.id);
			if (e) throw e;
			const counts = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 };
			(data || []).forEach((r) => {
				if (counts[r.status] !== undefined) counts[r.status] += 1;
			});
			setDrawer({ campaign: row, stats: counts, loading: false });
		} catch (err) {
			toast.error(err.message || t('toast.statsLoadFailed'));
			setDrawer({ campaign: row, stats: null, loading: false });
		}
	};

	const duplicate = async (row) => {
		setActingId(row.id);
		try {
			const { data: full, error: e1 } = await supabase
				.from('email_campaigns')
				.select('*')
				.eq('id', row.id)
				.single();
			if (e1) throw e1;
			const dup = {
				name: `${full.name}${t('duplicateLabel')}`,
				subject: full.subject,
				html_content: full.html_content,
				from_name: full.from_name,
				from_email: full.from_email,
				reply_to: full.reply_to,
				segment_filter: full.segment_filter,
				status: 'draft',
			};
			const { data: ins, error: e2 } = await supabase
				.from('email_campaigns')
				.insert(dup)
				.select('id')
				.single();
			if (e2) throw e2;
			toast.success(t('toast.duplicated'));
			navigate(`/admin/email/campaigns/${ins.id}/edit`);
		} catch (err) {
			toast.error(err.message || t('toast.duplicateFailed'));
		} finally {
			setActingId(null);
		}
	};

	const deleteDraft = async (row) => {
		if (row.status !== 'draft') {
			toast.error(t('toast.onlyDrafts'));
			return;
		}
		if (!confirm(t('confirm.delete', { name: row.name }))) return;
		setActingId(row.id);
		try {
			const { error: e } = await supabase.from('email_campaigns').delete().eq('id', row.id);
			if (e) throw e;
			toast.success(t('toast.draftDeleted'));
			await loadPage();
		} catch (err) {
			toast.error(err.message || t('toast.deleteFailed'));
		} finally {
			setActingId(null);
		}
	};

	return (
		<>
			<Helmet>
				<title>{t('seoTitle')}</title>
			</Helmet>
			<Navigation />
			<main id="main" role="main" className="min-h-screen bg-background pt-32 pb-20 px-4 sm:px-6 lg:px-8">
				<div className="max-w-7xl mx-auto">
					<div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
						<div>
							<Link to="/admin/email" className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-foreground/60 hover:text-foreground mb-3">
								<ArrowLeft className="w-3 h-3" /> {t('backToDashboard')}
							</Link>
							<h1 className="text-3xl sm:text-4xl font-light text-foreground flex items-center gap-3">
								<Send className="w-8 h-8 text-mango-500" /> {t('heading')}
							</h1>
							<p className="text-foreground/60 mt-2 font-light">
								{t('subheading')}
							</p>
						</div>
						<div className="flex gap-3">
							<Button onClick={loadPage} variant="ghost" className="border border-foreground/10 text-foreground">
								<RefreshCw className="w-4 h-4 mr-2" /> {t('buttons.refresh')}
							</Button>
							<Link to="/admin/email/campaigns/new">
								<Button className="bg-mango-500 hover:bg-mango-600 text-stone-900">
									<Plus className="w-4 h-4 mr-2" /> {t('buttons.newCampaign')}
								</Button>
							</Link>
						</div>
					</div>

					{/* Filters */}
					<div className="flex flex-wrap items-center gap-3 mb-6">
						<div className="flex rounded-md border border-foreground/10 bg-card overflow-hidden">
							{[
								{ key: 'all', label: t('filters.all') },
								{ key: 'draft', label: t('filters.draft') },
								{ key: 'sending', label: t('filters.sending') },
								{ key: 'sent', label: t('filters.sent') },
								{ key: 'failed', label: t('filters.failed') },
							].map((opt) => (
								<button
									key={opt.key}
									type="button"
									onClick={() => setStatusFilter(opt.key)}
									className={`px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
										statusFilter === opt.key ? 'bg-mango-500/15 text-mango-300' : 'text-foreground/60 hover:text-foreground'
									}`}
								>
									{opt.label}
								</button>
							))}
						</div>
						<label className="text-xs uppercase tracking-widest text-foreground/50 flex items-center gap-2">
							{t('filters.from')}
							<input
								type="date"
								value={fromDate}
								onChange={(e) => setFromDate(e.target.value)}
								className="px-2 py-1 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
							/>
						</label>
						<label className="text-xs uppercase tracking-widest text-foreground/50 flex items-center gap-2">
							{t('filters.to')}
							<input
								type="date"
								value={toDate}
								onChange={(e) => setToDate(e.target.value)}
								className="px-2 py-1 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
							/>
						</label>
						{(fromDate || toDate) && (
							<button
								className="text-xs text-foreground/60 underline"
								onClick={() => {
									setFromDate('');
									setToDate('');
								}}
							>
								{t('buttons.clearDates')}
							</button>
						)}
					</div>

					{error && (
						<div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 flex items-start gap-2">
							<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
							<span>{error}</span>
						</div>
					)}

					{loading ? (
						<div className="flex items-center justify-center py-20">
							<Loader2 className="w-8 h-8 text-mango-500 animate-spin" />
						</div>
					) : rows.length === 0 ? (
						<div className="text-center py-20 border border-dashed border-foreground/10 rounded-2xl">
							<Inbox className="w-10 h-10 mx-auto text-foreground/30 mb-3" />
							<p className="text-foreground/60">{t('table.empty')}</p>
							<Link to="/admin/email/campaigns/new">
								<Button className="mt-4 bg-mango-500 hover:bg-mango-600 text-stone-900">
									<Plus className="w-4 h-4 mr-2" /> {t('buttons.createFirst')}
								</Button>
							</Link>
						</div>
					) : (
						<>
							<div className="overflow-x-auto rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm">
								<table className="w-full text-sm text-left">
									<thead className="bg-card text-foreground/60 uppercase text-xs tracking-wider">
										<tr>
											<th className="px-4 py-3">{t('table.name')}</th>
											<th className="px-4 py-3">{t('table.subject')}</th>
											<th className="px-4 py-3">{t('table.audience')}</th>
											<th className="px-4 py-3 text-right">{t('table.recipients')}</th>
											<th className="px-4 py-3">{t('table.status')}</th>
											<th className="px-4 py-3">{t('table.sent')}</th>
											<th className="px-4 py-3 text-right">{t('table.actions')}</th>
										</tr>
									</thead>
									<tbody>
										{rows.map((r) => {
											const busy = actingId === r.id;
											return (
												<tr key={r.id} className="border-t border-foreground/5 hover:bg-foreground/5 transition-colors">
													<td className="px-4 py-3 text-foreground/80">{r.name}</td>
													<td className="px-4 py-3 text-foreground/70">{r.subject}</td>
													<td className="px-4 py-3 text-foreground/60 text-xs">
														{summarizeSegmentFilter(r.segment_filter)}
													</td>
													<td className="px-4 py-3 text-right text-foreground/80">{r.recipients_count || 0}</td>
													<td className="px-4 py-3">
														<span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${statusBadgeClass(r.status)}`}>
															{r.status}
														</span>
													</td>
													<td className="px-4 py-3 text-foreground/60">{formatDateTime(r.sent_at)}</td>
													<td className="px-4 py-3">
														<div className="flex justify-end gap-2">
															<Button size="sm" variant="ghost" onClick={() => openDrawer(r)} className="border border-foreground/10 text-foreground">
																<Eye className="w-3 h-3 mr-1" /> {t('buttons.view')}
															</Button>
															{r.status === 'draft' && (
																<Link to={`/admin/email/campaigns/${r.id}/edit`}>
																	<Button size="sm" variant="ghost" className="border border-foreground/10 text-foreground">
																		{t('buttons.edit')}
																	</Button>
																</Link>
															)}
															<Button size="sm" variant="ghost" disabled={busy} onClick={() => duplicate(r)} className="border border-foreground/10 text-foreground">
																{busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Copy className="w-3 h-3 mr-1" />}
																{t('buttons.duplicate')}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																disabled={busy || r.status !== 'draft'}
																onClick={() => deleteDraft(r)}
																className="text-red-300 hover:text-red-200 border border-red-500/30"
															>
																<Trash2 className="w-3 h-3 mr-1" /> {t('buttons.delete')}
															</Button>
														</div>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>

							<div className="flex items-center justify-between mt-6">
								<div className="text-xs text-foreground/60">
									{t(totalCount === 1 ? 'pagination.summary' : 'pagination.summaryPlural', { page: page + 1, total: totalPages, count: totalCount })}
								</div>
								<div className="flex gap-2">
									<Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="border border-foreground/10 text-foreground">
										<ChevronLeft className="w-4 h-4 mr-1" /> {t('buttons.prev')}
									</Button>
									<Button variant="ghost" size="sm" onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={page + 1 >= totalPages} className="border border-foreground/10 text-foreground">
										{t('buttons.next')} <ChevronRight className="w-4 h-4 ml-1" />
									</Button>
								</div>
							</div>
						</>
					)}
				</div>
			</main>

			{drawer && (
				<div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setDrawer(null)}>
					<aside
						className="bg-card border-l border-foreground/10 w-full max-w-md h-full overflow-y-auto p-6"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-xl font-light text-foreground">{t('drawer.title')}</h2>
							<button onClick={() => setDrawer(null)} className="text-foreground/50 hover:text-foreground">
								<X className="w-5 h-5" />
							</button>
						</div>
						<dl className="space-y-3 text-sm">
							<Field label={t('drawer.name')} value={drawer.campaign.name} />
							<Field label={t('drawer.subject')} value={drawer.campaign.subject} />
							<Field label={t('drawer.status')} value={drawer.campaign.status} />
							<Field label={t('drawer.recipients')} value={drawer.campaign.recipients_count || 0} />
							<Field label={t('drawer.sentAt')} value={formatDateTime(drawer.campaign.sent_at)} />
							<Field label={t('drawer.audience')} value={summarizeSegmentFilter(drawer.campaign.segment_filter)} />
						</dl>
						<h3 className="text-xs uppercase tracking-widest text-foreground/50 mt-6 mb-3">{t('drawer.engagement')}</h3>
						{drawer.loading ? (
							<div className="flex justify-center py-6">
								<Loader2 className="w-5 h-5 animate-spin text-foreground/40" />
							</div>
						) : drawer.stats ? (
							<div className="grid grid-cols-2 gap-3">
								{Object.entries(drawer.stats).map(([k, v]) => (
									<div key={k} className="rounded-xl border border-foreground/10 bg-background/40 p-3">
										<div className="text-xs uppercase tracking-widest text-foreground/50">{k}</div>
										<div className="text-2xl font-light text-foreground">{v}</div>
									</div>
								))}
							</div>
						) : (
							<p className="text-foreground/50 text-sm italic">{t('drawer.noStats')}</p>
						)}
					</aside>
				</div>
			)}

			<Footer />
		</>
	);
};

const Field = ({ label, value }) => (
	<div>
		<dt className="text-xs uppercase tracking-widest text-foreground/50">{label}</dt>
		<dd className="text-foreground/80">{value || '—'}</dd>
	</div>
);

export default EmailCampaignsPage;
