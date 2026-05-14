import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
	Loader2,
	RefreshCw,
	AlertTriangle,
	FileText,
	ArrowLeft,
	Pencil,
	RotateCcw,
	Inbox,
	X,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';

// Per-type list of editable fields (in addition to the always-shown
// subject / heading / intro). admin_* are intro-only (no totals, no CTA).
const FIELDS_BY_TYPE = {
	confirmation: ['outro', 'items_label', 'subtotal_label', 'shipping_label', 'total_label', 'ship_to_label'],
	tracking: ['outro', 'tracking_label', 'method_label'],
	refund: ['outro'],
	abandoned_cart: ['outro', 'items_label', 'subtotal_label', 'shipping_label', 'total_label', 'ship_to_label', 'cta_label'],
	admin_new_order: [],
	admin_refunded: [],
};

const TYPE_ORDER = ['confirmation', 'tracking', 'refund', 'abandoned_cart', 'admin_new_order', 'admin_refunded'];
const LANG_ORDER = ['es', 'en'];

const formatDate = (iso) => {
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

const truncate = (s, n = 60) => {
	if (!s) return '';
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const EmailTemplatesPage = () => {
	const { t } = useTranslation('adminEmailTemplates');
	const [rows, setRows] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [editing, setEditing] = useState(null); // row being edited
	const [form, setForm] = useState({});
	const [saving, setSaving] = useState(false);
	const [resettingId, setResettingId] = useState(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const { data, error: e } = await supabase
				.from('email_templates')
				.select('*');
			if (e) throw e;
			// Sort by (TYPE_ORDER, LANG_ORDER) so admin always sees them in the
			// same predictable order regardless of insert order.
			const sorted = (data || []).slice().sort((a, b) => {
				const ti = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
				if (ti !== 0) return ti;
				return LANG_ORDER.indexOf(a.lang) - LANG_ORDER.indexOf(b.lang);
			});
			setRows(sorted);
		} catch (err) {
			setError(err.message || t('toast.loadFailed'));
			setRows([]);
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		load();
	}, [load]);

	const openEdit = (row) => {
		setEditing(row);
		setForm({
			subject: row.subject || '',
			heading: row.heading || '',
			intro: row.intro || '',
			outro: row.outro || '',
			items_label: row.items_label || '',
			subtotal_label: row.subtotal_label || '',
			shipping_label: row.shipping_label || '',
			total_label: row.total_label || '',
			ship_to_label: row.ship_to_label || '',
			tracking_label: row.tracking_label || '',
			method_label: row.method_label || '',
			cta_label: row.cta_label || '',
		});
	};

	const saveForm = async (e) => {
		e.preventDefault();
		if (!editing) return;
		setSaving(true);
		try {
			const optionalFields = FIELDS_BY_TYPE[editing.type] || [];
			// Build payload: always subject/heading/intro; conditional fields
			// only included if the type uses them. Empty strings on optional
			// fields are stored as NULL so the function falls back per-field.
			const payload = {
				subject: form.subject.trim(),
				heading: form.heading.trim(),
				intro: form.intro.trim(),
			};
			for (const f of optionalFields) {
				const v = (form[f] || '').trim();
				payload[f] = v ? v : null;
			}
			const { error: e2 } = await supabase
				.from('email_templates')
				.update(payload)
				.eq('id', editing.id);
			if (e2) throw e2;
			toast.success(t('toast.saved'));
			setEditing(null);
			await load();
		} catch (err) {
			toast.error(err.message || t('toast.saveFailed'));
		} finally {
			setSaving(false);
		}
	};

	const handleReset = async (row) => {
		const msg = t('confirm.reset', {
			type: t(`types.${row.type}`),
			lang: t(`langs.${row.lang}`),
		});
		if (!confirm(msg)) return;
		setResettingId(row.id);
		try {
			const { error: e } = await supabase.from('email_templates').delete().eq('id', row.id);
			if (e) throw e;
			toast.success(t('toast.reset'));
			await load();
		} catch (err) {
			toast.error(err.message || t('toast.resetFailed'));
		} finally {
			setResettingId(null);
		}
	};

	const optionalFields = useMemo(
		() => (editing ? FIELDS_BY_TYPE[editing.type] || [] : []),
		[editing],
	);

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
								<FileText className="w-8 h-8 text-mango-500" /> {t('heading')}
							</h1>
							<p className="text-foreground/60 mt-2 font-light max-w-2xl">{t('subheading')}</p>
							<p className="text-foreground/50 mt-1 text-xs">{t('intro')}</p>
						</div>
						<div className="flex flex-wrap gap-3">
							<Button onClick={load} variant="ghost" className="border border-foreground/10 text-foreground">
								<RefreshCw className="w-4 h-4 mr-2" /> {t('buttons.refresh')}
							</Button>
						</div>
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
						</div>
					) : (
						<div className="overflow-x-auto rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm">
							<table className="w-full text-sm text-left">
								<thead className="bg-card text-foreground/60 uppercase text-xs tracking-wider">
									<tr>
										<th className="px-4 py-3">{t('table.type')}</th>
										<th className="px-4 py-3">{t('table.lang')}</th>
										<th className="px-4 py-3">{t('table.subject')}</th>
										<th className="px-4 py-3">{t('table.updated')}</th>
										<th className="px-4 py-3 text-right">{t('table.actions')}</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((r) => {
										const busy = resettingId === r.id;
										return (
											<tr
												key={r.id}
												className="border-t border-foreground/5 hover:bg-foreground/5 transition-colors cursor-pointer"
												onClick={() => openEdit(r)}
											>
												<td className="px-4 py-3 text-foreground/80">{t(`types.${r.type}`)}</td>
												<td className="px-4 py-3">
													<span className="inline-flex items-center px-2 py-1 rounded-full text-xs border bg-card border-foreground/10 text-foreground/70 uppercase">
														{r.lang}
													</span>
												</td>
												<td className="px-4 py-3 text-foreground/70 max-w-md">{truncate(r.subject)}</td>
												<td className="px-4 py-3 text-foreground/60">{formatDate(r.updated_at)}</td>
												<td className="px-4 py-3">
													<div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
														<Button
															size="sm"
															variant="ghost"
															onClick={() => openEdit(r)}
															className="border border-foreground/10 text-foreground"
														>
															<Pencil className="w-3 h-3 mr-1" /> {t('buttons.edit')}
														</Button>
														<Button
															size="sm"
															variant="ghost"
															disabled={busy}
															onClick={() => handleReset(r)}
															className="text-red-300 hover:text-red-200 border border-red-500/30"
														>
															{busy ? (
																<Loader2 className="w-3 h-3 mr-1 animate-spin" />
															) : (
																<RotateCcw className="w-3 h-3 mr-1" />
															)}
															{t('buttons.resetToDefault')}
														</Button>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</main>

			{editing && (
				<Modal
					title={`${t('modal.editTitle')} — ${t(`types.${editing.type}`)} (${t(`langs.${editing.lang}`)})`}
					onClose={() => setEditing(null)}
				>
					<form onSubmit={saveForm} className="space-y-4">
						<div>
							<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">
								{t('modal.fields.subject')}
							</label>
							<input
								type="text"
								required
								value={form.subject}
								onChange={(e) => setForm({ ...form, subject: e.target.value })}
								className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
							/>
							<p className="text-[11px] text-foreground/50 mt-1">{t('modal.fields.subjectHelp')}</p>
						</div>
						<div>
							<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">
								{t('modal.fields.heading')}
							</label>
							<input
								type="text"
								required
								value={form.heading}
								onChange={(e) => setForm({ ...form, heading: e.target.value })}
								className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
							/>
						</div>
						<div>
							<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">
								{t('modal.fields.intro')}
							</label>
							<textarea
								required
								rows={3}
								value={form.intro}
								onChange={(e) => setForm({ ...form, intro: e.target.value })}
								className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
							/>
						</div>

						{optionalFields.includes('outro') && (
							<TextareaField
								label={t('modal.fields.outro')}
								value={form.outro}
								onChange={(v) => setForm({ ...form, outro: v })}
							/>
						)}

						<div className="grid grid-cols-2 gap-3">
							{optionalFields.includes('items_label') && (
								<TextField
									label={t('modal.fields.itemsLabel')}
									value={form.items_label}
									onChange={(v) => setForm({ ...form, items_label: v })}
								/>
							)}
							{optionalFields.includes('subtotal_label') && (
								<TextField
									label={t('modal.fields.subtotalLabel')}
									value={form.subtotal_label}
									onChange={(v) => setForm({ ...form, subtotal_label: v })}
								/>
							)}
							{optionalFields.includes('shipping_label') && (
								<TextField
									label={t('modal.fields.shippingLabel')}
									value={form.shipping_label}
									onChange={(v) => setForm({ ...form, shipping_label: v })}
								/>
							)}
							{optionalFields.includes('total_label') && (
								<TextField
									label={t('modal.fields.totalLabel')}
									value={form.total_label}
									onChange={(v) => setForm({ ...form, total_label: v })}
								/>
							)}
							{optionalFields.includes('ship_to_label') && (
								<TextField
									label={t('modal.fields.shipToLabel')}
									value={form.ship_to_label}
									onChange={(v) => setForm({ ...form, ship_to_label: v })}
								/>
							)}
							{optionalFields.includes('tracking_label') && (
								<TextField
									label={t('modal.fields.trackingLabel')}
									value={form.tracking_label}
									onChange={(v) => setForm({ ...form, tracking_label: v })}
								/>
							)}
							{optionalFields.includes('method_label') && (
								<TextField
									label={t('modal.fields.methodLabel')}
									value={form.method_label}
									onChange={(v) => setForm({ ...form, method_label: v })}
								/>
							)}
							{optionalFields.includes('cta_label') && (
								<TextField
									label={t('modal.fields.ctaLabel')}
									value={form.cta_label}
									onChange={(v) => setForm({ ...form, cta_label: v })}
								/>
							)}
						</div>

						<div className="flex justify-end gap-2 pt-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => setEditing(null)}
								className="border border-foreground/10 text-foreground"
							>
								{t('buttons.cancel')}
							</Button>
							<Button
								type="submit"
								disabled={saving}
								className="bg-mango-500 hover:bg-mango-600 text-stone-900"
							>
								{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} {t('buttons.save')}
							</Button>
						</div>
					</form>
				</Modal>
			)}

			<Footer />
		</>
	);
};

const Modal = ({ title, children, onClose }) => (
	<div
		className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		onClick={onClose}
	>
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

const TextField = ({ label, value, onChange }) => (
	<div>
		<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{label}</label>
		<input
			type="text"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
		/>
	</div>
);

const TextareaField = ({ label, value, onChange }) => (
	<div>
		<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{label}</label>
		<textarea
			rows={3}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-mango-500/40"
		/>
	</div>
);

export default EmailTemplatesPage;
