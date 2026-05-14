import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
	Loader2,
	RefreshCw,
	AlertTriangle,
	Search,
	Users,
	ChevronLeft,
	ChevronRight,
	ArrowLeft,
	Download,
	UserX,
	Trash2,
	Inbox,
	Plus,
	Upload,
	Pencil,
	X,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 25;

const csvEscape = (val) => {
	if (val === null || val === undefined) return '';
	const s = String(val);
	if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
};

const formatDate = (iso) => {
	if (!iso) return '—';
	try {
		return new Date(iso).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	} catch {
		return '—';
	}
};

const TABLE_COLUMNS =
	'id, email, first_name, last_name, company_name, segment, subtype_tags, merge_vars, status, notes, source, created_at, updated_at';

const emptyForm = {
	email: '',
	first_name: '',
	last_name: '',
	company_name: '',
	segment: 'individual',
	subtype_tags: '',
	merge_vars: [{ k: '', v: '' }],
	notes: '',
};

const parseCsvLine = (line) => {
	// Minimal RFC-4180 line splitter (handles "quoted, commas").
	const out = [];
	let cur = '';
	let inQ = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (inQ) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i += 1;
			} else if (ch === '"') {
				inQ = false;
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			inQ = true;
		} else if (ch === ',') {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out.map((s) => s.trim());
};

const EmailContactsPage = () => {
	const { t } = useTranslation('adminEmailContacts');
	const [rows, setRows] = useState([]);
	const [totalCount, setTotalCount] = useState(0);
	const [page, setPage] = useState(0);
	const [search, setSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [segmentFilter, setSegmentFilter] = useState('all');
	const [statusFilter, setStatusFilter] = useState('all');
	const [tagFilter, setTagFilter] = useState([]); // multi
	const [knownTags, setKnownTags] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [exporting, setExporting] = useState(false);
	const [actingId, setActingId] = useState(null);
	const [kpis, setKpis] = useState({ total: 0, active: 0, b2b: 0, individual: 0 });
	const [kpisLoading, setKpisLoading] = useState(true);

	const [showForm, setShowForm] = useState(false);
	const [editingId, setEditingId] = useState(null);
	const [form, setForm] = useState(emptyForm);
	const [saving, setSaving] = useState(false);

	const [showImport, setShowImport] = useState(false);
	const [csvText, setCsvText] = useState('');
	const [importing, setImporting] = useState(false);
	const [importPreview, setImportPreview] = useState({ rows: [], errors: [] });

	const debounceRef = useRef(null);

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setDebouncedSearch(search.trim());
			setPage(0);
		}, 300);
		return () => debounceRef.current && clearTimeout(debounceRef.current);
	}, [search]);

	useEffect(() => {
		setPage(0);
	}, [segmentFilter, statusFilter, tagFilter]);

	const loadKpis = useCallback(async () => {
		setKpisLoading(true);
		try {
			const [total, active, b2b, individual] = await Promise.all([
				supabase.from('email_contacts').select('id', { count: 'exact', head: true }),
				supabase.from('email_contacts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
				supabase.from('email_contacts').select('id', { count: 'exact', head: true }).eq('segment', 'b2b'),
				supabase.from('email_contacts').select('id', { count: 'exact', head: true }).eq('segment', 'individual'),
			]);
			setKpis({
				total: total.count || 0,
				active: active.count || 0,
				b2b: b2b.count || 0,
				individual: individual.count || 0,
			});
		} catch (err) {
			console.error('KPIs failed', err);
		} finally {
			setKpisLoading(false);
		}
	}, []);

	const loadTags = useCallback(async () => {
		const { data } = await supabase
			.from('email_contacts')
			.select('subtype_tags')
			.limit(2000);
		const set = new Set();
		(data || []).forEach((r) => (r.subtype_tags || []).forEach((t) => t && set.add(t)));
		setKnownTags(Array.from(set).sort());
	}, []);

	const applyFilters = useCallback(
		(q) => {
			let out = q;
			if (debouncedSearch) {
				const safe = debouncedSearch.replace(/[%,]/g, ' ');
				out = out.or(
					`email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company_name.ilike.%${safe}%`,
				);
			}
			if (segmentFilter !== 'all') out = out.eq('segment', segmentFilter);
			if (statusFilter !== 'all') out = out.eq('status', statusFilter);
			if (tagFilter.length) out = out.contains('subtype_tags', tagFilter);
			return out;
		},
		[debouncedSearch, segmentFilter, statusFilter, tagFilter],
	);

	const loadPage = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const from = page * PAGE_SIZE;
			const to = from + PAGE_SIZE - 1;
			let query = supabase
				.from('email_contacts')
				.select(TABLE_COLUMNS, { count: 'exact' })
				.order('created_at', { ascending: false })
				.range(from, to);
			query = applyFilters(query);
			const { data, error: e, count } = await query;
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
	}, [page, applyFilters, t]);

	useEffect(() => {
		loadKpis();
		loadTags();
	}, [loadKpis, loadTags]);

	useEffect(() => {
		loadPage();
	}, [loadPage]);

	const totalPages = useMemo(
		() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
		[totalCount],
	);

	const handleRefresh = () => {
		loadKpis();
		loadTags();
		loadPage();
	};

	const openCreate = () => {
		setEditingId(null);
		setForm(emptyForm);
		setShowForm(true);
	};

	const openEdit = (row) => {
		setEditingId(row.id);
		const mvEntries = Object.entries(row.merge_vars || {});
		setForm({
			email: row.email || '',
			first_name: row.first_name || '',
			last_name: row.last_name || '',
			company_name: row.company_name || '',
			segment: row.segment || 'individual',
			subtype_tags: (row.subtype_tags || []).join(', '),
			merge_vars: mvEntries.length ? mvEntries.map(([k, v]) => ({ k, v: String(v ?? '') })) : [{ k: '', v: '' }],
			notes: row.notes || '',
		});
		setShowForm(true);
	};

	const saveForm = async (e) => {
		e.preventDefault();
		if (!form.email) {
			toast.error(t('toast.emailRequired'));
			return;
		}
		setSaving(true);
		try {
			const tags = form.subtype_tags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			const merge = {};
			for (const { k, v } of form.merge_vars) {
				if (!k) continue;
				merge[k.trim()] = v;
			}
			const payload = {
				email: form.email.trim().toLowerCase(),
				first_name: form.first_name || null,
				last_name: form.last_name || null,
				company_name: form.company_name || null,
				segment: form.segment,
				subtype_tags: tags,
				merge_vars: merge,
				notes: form.notes || null,
			};
			let resp;
			if (editingId) {
				resp = await supabase.from('email_contacts').update(payload).eq('id', editingId);
			} else {
				resp = await supabase.from('email_contacts').insert(payload);
			}
			if (resp.error) throw resp.error;
			toast.success(editingId ? t('toast.updated') : t('toast.created'));
			setShowForm(false);
			await Promise.all([loadPage(), loadKpis(), loadTags()]);
		} catch (err) {
			toast.error(err.message || t('toast.saveFailed'));
		} finally {
			setSaving(false);
		}
	};

	const handleUnsubscribe = async (row) => {
		if (row.status === 'unsubscribed') {
			toast.info(t('toast.alreadyUnsubscribed'));
			return;
		}
		if (!confirm(t('confirm.unsubscribe', { email: row.email }))) return;
		setActingId(row.id);
		try {
			const { error: e } = await supabase
				.from('email_contacts')
				.update({ status: 'unsubscribed' })
				.eq('id', row.id);
			if (e) throw e;
			toast.success(t('toast.unsubscribed'));
			await Promise.all([loadPage(), loadKpis()]);
		} catch (err) {
			toast.error(err.message || t('toast.failed'));
		} finally {
			setActingId(null);
		}
	};

	const handleDelete = async (row) => {
		if (!confirm(t('confirm.delete', { email: row.email }))) return;
		setActingId(row.id);
		try {
			const { error: e } = await supabase.from('email_contacts').delete().eq('id', row.id);
			if (e) throw e;
			toast.success(t('toast.deleted'));
			await Promise.all([loadPage(), loadKpis()]);
		} catch (err) {
			toast.error(err.message || t('toast.failed'));
		} finally {
			setActingId(null);
		}
	};

	const handleExport = async () => {
		setExporting(true);
		try {
			const chunk = 1000;
			let offset = 0;
			let all = [];
			while (true) {
				let q = supabase
					.from('email_contacts')
					.select(TABLE_COLUMNS)
					.order('created_at', { ascending: false })
					.range(offset, offset + chunk - 1);
				q = applyFilters(q);
				const { data, error: e } = await q;
				if (e) throw e;
				const batch = data || [];
				all = all.concat(batch);
				if (batch.length < chunk) break;
				offset += chunk;
				if (all.length >= 50000) break;
			}
			if (!all.length) {
				toast.info(t('toast.noneToExport'));
				return;
			}
			const headers = [
				'email',
				'first_name',
				'last_name',
				'company_name',
				'segment',
				'subtype_tags',
				'status',
				'notes',
				'created_at',
			];
			const lines = [headers.join(',')];
			for (const r of all) {
				lines.push(
					[
						r.email,
						r.first_name,
						r.last_name,
						r.company_name,
						r.segment,
						(r.subtype_tags || []).join('|'),
						r.status,
						r.notes,
						r.created_at,
					]
						.map(csvEscape)
						.join(','),
				);
			}
			const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `email-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			toast.success(t(all.length === 1 ? 'toast.exported' : 'toast.exportedPlural', { count: all.length }));
		} catch (err) {
			toast.error(err.message || t('toast.exportFailed'));
		} finally {
			setExporting(false);
		}
	};

	const handleCsvPreview = (text) => {
		setCsvText(text);
		const lines = text.split(/\r?\n/).filter((l) => l.trim());
		if (lines.length < 2) {
			setImportPreview({ rows: [], errors: lines.length === 0 ? [] : [t('csvErrors.needRows')] });
			return;
		}
		const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
		const idx = (name) => headers.indexOf(name);
		const emailIdx = idx('email');
		if (emailIdx === -1) {
			setImportPreview({ rows: [], errors: [t('csvErrors.missingEmailCol')] });
			return;
		}
		const errors = [];
		const parsed = [];
		for (let i = 1; i < lines.length; i += 1) {
			const cols = parseCsvLine(lines[i]);
			const email = (cols[emailIdx] || '').trim().toLowerCase();
			if (!email) {
				errors.push(t('csvErrors.missingEmail', { row: i + 1 }));
				continue;
			}
			if (!/^.+@.+\..+$/.test(email)) {
				errors.push(t('csvErrors.invalidEmail', { row: i + 1, email }));
				continue;
			}
			const seg = (cols[idx('segment')] || 'individual').trim().toLowerCase();
			const segment = seg === 'b2b' ? 'b2b' : 'individual';
			const tagsRaw = cols[idx('tags')] || cols[idx('subtype_tags')] || '';
			const tags = tagsRaw
				.split(/[|;,]/)
				.map((t) => t.trim())
				.filter(Boolean);
			parsed.push({
				email,
				first_name: cols[idx('first_name')] || null,
				last_name: cols[idx('last_name')] || null,
				company_name: cols[idx('company_name')] || null,
				segment,
				subtype_tags: tags,
			});
		}
		setImportPreview({ rows: parsed, errors });
	};

	const runImport = async () => {
		if (!importPreview.rows.length) {
			toast.error(t('toast.nothingToImport'));
			return;
		}
		setImporting(true);
		try {
			const { error: e } = await supabase
				.from('email_contacts')
				.upsert(importPreview.rows, { onConflict: 'email' });
			if (e) throw e;
			toast.success(t('toast.imported', { count: importPreview.rows.length }));
			setShowImport(false);
			setCsvText('');
			setImportPreview({ rows: [], errors: [] });
			await Promise.all([loadPage(), loadKpis(), loadTags()]);
		} catch (err) {
			toast.error(err.message || t('toast.importFailed'));
		} finally {
			setImporting(false);
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
							<Link
								to="/admin/email"
								className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-foreground/60 hover:text-foreground mb-3"
							>
								<ArrowLeft className="w-3 h-3" /> {t('backToDashboard')}
							</Link>
							<h1 className="text-3xl sm:text-4xl font-light text-foreground flex items-center gap-3">
								<Users className="w-8 h-8 text-mango-500" /> {t('heading')}
							</h1>
							<p className="text-foreground/60 mt-2 font-light">
								{t('subheadingPrefix')} <code className="text-xs">email_contacts</code>{t('subheadingSuffix')}
							</p>
						</div>
						<div className="flex flex-wrap gap-3">
							<Button onClick={handleRefresh} variant="ghost" className="border border-foreground/10 text-foreground">
								<RefreshCw className="w-4 h-4 mr-2" /> {t('buttons.refresh')}
							</Button>
							<Button onClick={() => setShowImport(true)} variant="ghost" className="border border-foreground/10 text-foreground">
								<Upload className="w-4 h-4 mr-2" /> {t('buttons.bulkImport')}
							</Button>
							<Button onClick={handleExport} disabled={exporting} variant="ghost" className="border border-foreground/10 text-foreground">
								{exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} {t('buttons.csv')}
							</Button>
							<Button onClick={openCreate} className="bg-mango-500 hover:bg-mango-600 text-stone-900">
								<Plus className="w-4 h-4 mr-2" /> {t('buttons.addContact')}
							</Button>
						</div>
					</div>

					{/* KPIs */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
						<KpiTile loading={kpisLoading} label={t('kpis.total')} value={kpis.total} />
						<KpiTile loading={kpisLoading} label={t('kpis.active')} value={kpis.active} />
						<KpiTile loading={kpisLoading} label={t('kpis.b2b')} value={kpis.b2b} />
						<KpiTile loading={kpisLoading} label={t('kpis.individual')} value={kpis.individual} />
					</div>

					{/* Filters */}
					<div className="flex flex-wrap items-center gap-3 mb-6">
						<div className="relative flex-1 min-w-[16rem] max-w-md">
							<Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
							<input
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder={t('search.placeholder')}
								className="w-full pl-9 pr-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground placeholder:text-foreground/40 text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
							/>
						</div>
						<FilterChips
							value={segmentFilter}
							onChange={setSegmentFilter}
							options={[
								{ key: 'all', label: t('filters.segments.all') },
								{ key: 'b2b', label: t('filters.segments.b2b') },
								{ key: 'individual', label: t('filters.segments.individual') },
							]}
						/>
						<FilterChips
							value={statusFilter}
							onChange={setStatusFilter}
							options={[
								{ key: 'all', label: t('filters.status.all') },
								{ key: 'active', label: t('filters.status.active') },
								{ key: 'unsubscribed', label: t('filters.status.unsubscribed') },
								{ key: 'bounced', label: t('filters.status.bounced') },
							]}
						/>
					</div>

					{knownTags.length > 0 && (
						<div className="flex flex-wrap items-center gap-2 mb-6">
							<span className="text-xs uppercase tracking-widest text-foreground/50">{t('filters.tagsLabel')}</span>
							{knownTags.map((t) => {
								const on = tagFilter.includes(t);
								return (
									<button
										key={t}
										type="button"
										onClick={() =>
											setTagFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
										}
										className={`px-2 py-1 rounded-full text-xs border transition ${
											on
												? 'bg-mango-500/20 text-mango-300 border-mango-500/40'
												: 'bg-card border-foreground/10 text-foreground/60 hover:text-foreground'
										}`}
									>
										{t}
									</button>
								);
							})}
							{tagFilter.length > 0 && (
								<button
									type="button"
									className="text-xs text-foreground/50 underline ml-1"
									onClick={() => setTagFilter([])}
								>
									{t('filters.tagsClear')}
								</button>
							)}
						</div>
					)}

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
						</div>
					) : (
						<>
							<div className="overflow-x-auto rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm">
								<table className="w-full text-sm text-left">
									<thead className="bg-card text-foreground/60 uppercase text-xs tracking-wider">
										<tr>
											<th className="px-4 py-3">{t('table.email')}</th>
											<th className="px-4 py-3">{t('table.name')}</th>
											<th className="px-4 py-3">{t('table.company')}</th>
											<th className="px-4 py-3">{t('table.segment')}</th>
											<th className="px-4 py-3">{t('table.tags')}</th>
											<th className="px-4 py-3">{t('table.status')}</th>
											<th className="px-4 py-3">{t('table.created')}</th>
											<th className="px-4 py-3 text-right">{t('table.actions')}</th>
										</tr>
									</thead>
									<tbody>
										{rows.map((r) => {
											const busy = actingId === r.id;
											return (
												<tr key={r.id} className="border-t border-foreground/5 hover:bg-foreground/5 transition-colors">
													<td className="px-4 py-3 text-foreground/80">{r.email}</td>
													<td className="px-4 py-3 text-foreground/70">
														{[r.first_name, r.last_name].filter(Boolean).join(' ') || (
															<span className="text-foreground/40 italic">—</span>
														)}
													</td>
													<td className="px-4 py-3 text-foreground/70">
														{r.company_name || <span className="text-foreground/40 italic">—</span>}
													</td>
													<td className="px-4 py-3">
														<span className="inline-flex items-center px-2 py-1 rounded-full text-xs border bg-card border-foreground/10 text-foreground/70">
															{r.segment}
														</span>
													</td>
													<td className="px-4 py-3 text-foreground/60 text-xs">
														{(r.subtype_tags || []).join(', ')}
													</td>
													<td className="px-4 py-3">
														<StatusBadge status={r.status} />
													</td>
													<td className="px-4 py-3 text-foreground/60">{formatDate(r.created_at)}</td>
													<td className="px-4 py-3">
														<div className="flex justify-end gap-2">
															<Button size="sm" variant="ghost" disabled={busy} onClick={() => openEdit(r)} className="border border-foreground/10 text-foreground">
																<Pencil className="w-3 h-3 mr-1" /> {t('buttons.edit')}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																disabled={busy || r.status === 'unsubscribed'}
																onClick={() => handleUnsubscribe(r)}
																className="border border-foreground/10 text-foreground"
															>
																{busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserX className="w-3 h-3 mr-1" />}
																{t('buttons.unsub')}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																disabled={busy}
																onClick={() => handleDelete(r)}
																className="text-red-300 hover:text-red-200 border border-red-500/30"
															>
																{busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
																{t('buttons.delete')}
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

			{/* Add/Edit modal */}
			{showForm && (
				<Modal title={editingId ? t('modal.editTitle') : t('modal.addTitle')} onClose={() => setShowForm(false)}>
					<form onSubmit={saveForm} className="space-y-4">
						<Input label={t('modal.fields.email')} type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
						<div className="grid grid-cols-2 gap-3">
							<Input label={t('modal.fields.firstName')} value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
							<Input label={t('modal.fields.lastName')} value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
						</div>
						<Input label={t('modal.fields.company')} value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} />
						<div>
							<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{t('modal.fields.segment')}</label>
							<div className="flex gap-3">
								{['b2b', 'individual'].map((s) => (
									<label key={s} className="flex items-center gap-2 text-foreground/80 text-sm">
										<input
											type="radio"
											name="segment"
											value={s}
											checked={form.segment === s}
											onChange={() => setForm({ ...form, segment: s })}
										/>
										{s}
									</label>
								))}
							</div>
						</div>
						<Input label={t('modal.fields.tags')} value={form.subtype_tags} onChange={(v) => setForm({ ...form, subtype_tags: v })} placeholder={t('modal.fields.tagsPlaceholder')} />
						<div>
							<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{t('modal.fields.mergeVars')}</label>
							<div className="space-y-2">
								{form.merge_vars.map((mv, idx) => (
									<div key={idx} className="flex gap-2">
										<input
											value={mv.k}
											onChange={(e) => {
												const next = [...form.merge_vars];
												next[idx] = { ...next[idx], k: e.target.value };
												setForm({ ...form, merge_vars: next });
											}}
											placeholder={t('modal.fields.mergeVarKey')}
											className="flex-1 px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
										/>
										<input
											value={mv.v}
											onChange={(e) => {
												const next = [...form.merge_vars];
												next[idx] = { ...next[idx], v: e.target.value };
												setForm({ ...form, merge_vars: next });
											}}
											placeholder={t('modal.fields.mergeVarValue')}
											className="flex-1 px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
										/>
										<button
											type="button"
											className="px-2 text-foreground/50 hover:text-red-400"
											onClick={() => setForm({ ...form, merge_vars: form.merge_vars.filter((_, i) => i !== idx) })}
										>
											<X className="w-4 h-4" />
										</button>
									</div>
								))}
								<button
									type="button"
									className="text-xs text-mango-400 hover:text-mango-300"
									onClick={() => setForm({ ...form, merge_vars: [...form.merge_vars, { k: '', v: '' }] })}
								>
									{t('modal.fields.addMergeVar')}
								</button>
							</div>
						</div>
						<div>
							<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{t('modal.fields.notes')}</label>
							<textarea
								value={form.notes}
								onChange={(e) => setForm({ ...form, notes: e.target.value })}
								rows={3}
								className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
							/>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<Button type="button" variant="ghost" onClick={() => setShowForm(false)} className="border border-foreground/10 text-foreground">
								{t('buttons.cancel')}
							</Button>
							<Button type="submit" disabled={saving} className="bg-mango-500 hover:bg-mango-600 text-stone-900">
								{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} {t('buttons.save')}
							</Button>
						</div>
					</form>
				</Modal>
			)}

			{/* Import modal */}
			{showImport && (
				<Modal title={t('modal.importTitle')} onClose={() => setShowImport(false)}>
					<p className="text-xs text-foreground/60 mb-2">
						{t('modal.import.instructionsPrefix')} <code>email</code>, <code>first_name</code>, <code>last_name</code>,
						<code> company_name</code>, <code>segment</code> {t('modal.import.columnsHint')}, <code>tags</code> {t('modal.import.tagsHint')}
					</p>
					<textarea
						value={csvText}
						onChange={(e) => handleCsvPreview(e.target.value)}
						rows={10}
						placeholder={t('modal.import.csvPlaceholder')}
						className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-xs font-mono focus:outline-none focus:ring-2 focus:ring-mango-500/40"
					/>
					{importPreview.errors.length > 0 && (
						<div className="mt-2 text-xs text-red-300 space-y-1 max-h-32 overflow-y-auto">
							{importPreview.errors.map((e, i) => (
								<div key={i}>• {e}</div>
							))}
						</div>
					)}
					{importPreview.rows.length > 0 && (
						<div className="mt-3">
							<div className="text-xs text-foreground/60 mb-1">{t('modal.import.previewLabel', { count: importPreview.rows.length })}</div>
							<div className="overflow-x-auto rounded-md border border-foreground/10">
								<table className="w-full text-xs">
									<thead className="bg-card text-foreground/60">
										<tr>
											<th className="px-2 py-1 text-left">{t('modal.import.previewEmail')}</th>
											<th className="px-2 py-1 text-left">{t('modal.import.previewName')}</th>
											<th className="px-2 py-1 text-left">{t('modal.import.previewSegment')}</th>
											<th className="px-2 py-1 text-left">{t('modal.import.previewTags')}</th>
										</tr>
									</thead>
									<tbody>
										{importPreview.rows.slice(0, 5).map((r, i) => (
											<tr key={i} className="border-t border-foreground/5">
												<td className="px-2 py-1 text-foreground/80">{r.email}</td>
												<td className="px-2 py-1 text-foreground/70">
													{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}
												</td>
												<td className="px-2 py-1 text-foreground/70">{r.segment}</td>
												<td className="px-2 py-1 text-foreground/70">{(r.subtype_tags || []).join(', ')}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}
					<div className="flex justify-end gap-2 pt-4">
						<Button variant="ghost" onClick={() => setShowImport(false)} className="border border-foreground/10 text-foreground">
							{t('buttons.cancel')}
						</Button>
						<Button
							onClick={runImport}
							disabled={importing || !importPreview.rows.length}
							className="bg-mango-500 hover:bg-mango-600 text-stone-900"
						>
							{importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
							{t('modal.import.upsert', { count: importPreview.rows.length || 0 })}
						</Button>
					</div>
				</Modal>
			)}

			<Footer />
		</>
	);
};

const KpiTile = ({ loading, label, value }) => (
	<div className="rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm p-5">
		<div className="text-xs uppercase tracking-widest text-foreground/50">{label}</div>
		<div className="mt-2 text-3xl font-light text-foreground">
			{loading ? <Loader2 className="w-5 h-5 animate-spin text-foreground/40" /> : value}
		</div>
	</div>
);

const StatusBadge = ({ status }) => {
	const map = {
		active: 'bg-mango-500/15 text-mango-300 border-mango-500/40',
		unsubscribed: 'bg-stone-700/40 text-stone-300 border-stone-600',
		bounced: 'bg-red-500/15 text-red-300 border-red-500/40',
	};
	return (
		<span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${map[status] || 'bg-card border-foreground/10 text-foreground/60'}`}>
			{status}
		</span>
	);
};

const FilterChips = ({ value, onChange, options }) => (
	<div className="flex rounded-md border border-foreground/10 bg-card overflow-hidden">
		{options.map((opt) => (
			<button
				key={opt.key}
				type="button"
				onClick={() => onChange(opt.key)}
				className={`px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
					value === opt.key ? 'bg-mango-500/15 text-mango-300' : 'text-foreground/60 hover:text-foreground'
				}`}
			>
				{opt.label}
			</button>
		))}
	</div>
);

const Modal = ({ title, children, onClose }) => (
	<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
		<div
			className="bg-card border border-foreground/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
			onClick={(e) => e.stopPropagation()}
		>
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-xl font-light text-foreground">{title}</h2>
				<button onClick={onClose} className="text-foreground/50 hover:text-foreground">
					<X className="w-5 h-5" />
				</button>
			</div>
			{children}
		</div>
	</div>
);

const Input = ({ label, value, onChange, type = 'text', required, placeholder }) => (
	<div>
		<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{label}</label>
		<input
			type={type}
			required={required}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
		/>
	</div>
);

export default EmailContactsPage;
