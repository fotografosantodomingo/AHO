import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
	Loader2,
	ArrowLeft,
	Save,
	Send,
	Mail,
	AlertTriangle,
	X,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { sendCampaign } from '@/services/EmailMarketingService';

// Brand-portable. After install, set these to your brand. Optionally, override
// via Vite env vars at build time (so a fork doesn't have to edit the JSX):
//   VITE_EMAIL_DEFAULT_FROM_NAME, VITE_EMAIL_DEFAULT_FROM_EMAIL.
const DEFAULT_FROM_NAME =
	import.meta.env?.VITE_EMAIL_DEFAULT_FROM_NAME || 'Kibay';
const DEFAULT_FROM_EMAIL =
	import.meta.env?.VITE_EMAIL_DEFAULT_FROM_EMAIL || 'info@kibay.com.do';

const emptyForm = {
	name: '',
	subject: '',
	from_name: DEFAULT_FROM_NAME,
	from_email: DEFAULT_FROM_EMAIL,
	reply_to: '',
	html_content: '',
	segments: ['b2b', 'individual'],
	tags: [],
	status_filter: 'active',
};

const highlightPlaceholders = (html) =>
	String(html || '').replace(
		/\{\{\s*params\.([a-zA-Z0-9_]+)\s*\}\}/g,
		(_m, k) =>
			`<mark style="background:#fef08a;color:#422006;padding:0 2px;border-radius:2px;">{{params.${k}}}</mark>`,
	);

const substituteSample = (html, sample) =>
	String(html || '').replace(/\{\{\s*params\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
		const v = sample?.[k];
		return v !== undefined && v !== null ? String(v) : `{{params.${k}}}`;
	});

const EmailComposerPage = () => {
	const { t } = useTranslation('adminEmailComposer');
	const { id } = useParams();
	const navigate = useNavigate();
	const isEdit = Boolean(id);

	const [form, setForm] = useState(emptyForm);
	const [loadingInitial, setLoadingInitial] = useState(isEdit);
	const [error, setError] = useState(null);

	const [knownTags, setKnownTags] = useState([]);
	const [mergeVarKeys, setMergeVarKeys] = useState([]);
	const [sampleContact, setSampleContact] = useState(null);
	const [recipientCount, setRecipientCount] = useState(0);
	const [recipientLoading, setRecipientLoading] = useState(false);
	const [previewSample, setPreviewSample] = useState(false);

	const [saving, setSaving] = useState(false);
	const [sendingTest, setSendingTest] = useState(false);
	const [sending, setSending] = useState(false);
	const [confirmSend, setConfirmSend] = useState(false);
	const [adminEmail, setAdminEmail] = useState('');

	const textareaRef = useRef(null);
	const debounceRef = useRef(null);

	// Load admin email for the test-send button.
	useEffect(() => {
		(async () => {
			const { data } = await supabase.auth.getUser();
			setAdminEmail(data?.user?.email || '');
		})();
	}, []);

	// Load distinct tags & merge-var keys from active contacts.
	useEffect(() => {
		(async () => {
			const { data } = await supabase
				.from('email_contacts')
				.select('subtype_tags, merge_vars')
				.eq('status', 'active')
				.limit(2000);
			const tagSet = new Set();
			const keySet = new Set();
			(data || []).forEach((r) => {
				(r.subtype_tags || []).forEach((t) => t && tagSet.add(t));
				if (r.merge_vars && typeof r.merge_vars === 'object') {
					Object.keys(r.merge_vars).forEach((k) => keySet.add(k));
				}
			});
			setKnownTags(Array.from(tagSet).sort());
			setMergeVarKeys(Array.from(keySet).sort());
		})();
	}, []);

	// Load campaign for edit.
	useEffect(() => {
		if (!isEdit) return;
		(async () => {
			setLoadingInitial(true);
			try {
				const { data, error: e } = await supabase
					.from('email_campaigns')
					.select('*')
					.eq('id', id)
					.single();
				if (e) throw e;
				const sf = data.segment_filter || {};
				setForm({
					name: data.name || '',
					subject: data.subject || '',
					from_name: data.from_name || DEFAULT_FROM_NAME,
					from_email: data.from_email || DEFAULT_FROM_EMAIL,
					reply_to: data.reply_to || '',
					html_content: data.html_content || '',
					segments: Array.isArray(sf.segments) ? sf.segments : ['b2b', 'individual'],
					tags: Array.isArray(sf.tags) ? sf.tags : [],
					status_filter: sf.status || 'active',
				});
			} catch (err) {
				setError(err.message || t('toast.loadFailed'));
			} finally {
				setLoadingInitial(false);
			}
		})();
	}, [id, isEdit]);

	// Debounced recipient count + sample contact lookup.
	const queryAudience = useCallback(async () => {
		setRecipientLoading(true);
		try {
			let q = supabase.from('email_contacts').select('id', { count: 'exact', head: true });
			if (form.status_filter) q = q.eq('status', form.status_filter);
			if (form.segments?.length === 1) q = q.eq('segment', form.segments[0]);
			else if (form.segments?.length === 0) {
				setRecipientCount(0);
				setRecipientLoading(false);
				return;
			}
			// Use OR semantics on tags (overlaps) to match how the worker resolves
			// recipients at send time. `.contains` would require all tags to be
			// present on the contact, which is almost never what you want here.
			if (form.tags?.length) q = q.overlaps('subtype_tags', form.tags);
			const { count } = await q;
			setRecipientCount(count || 0);

			// Sample contact for preview.
			let sq = supabase.from('email_contacts').select('merge_vars, first_name, last_name, email').limit(1);
			if (form.status_filter) sq = sq.eq('status', form.status_filter);
			if (form.segments?.length === 1) sq = sq.eq('segment', form.segments[0]);
			if (form.tags?.length) sq = sq.overlaps('subtype_tags', form.tags);
			const { data: srows } = await sq;
			if (srows && srows[0]) {
				const c = srows[0];
				setSampleContact({
					first_name: c.first_name,
					last_name: c.last_name,
					email: c.email,
					...(c.merge_vars || {}),
				});
			} else {
				setSampleContact(null);
			}
		} catch (err) {
			console.error('Audience query failed', err);
		} finally {
			setRecipientLoading(false);
		}
	}, [form.segments, form.tags, form.status_filter]);

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(queryAudience, 300);
		return () => debounceRef.current && clearTimeout(debounceRef.current);
	}, [queryAudience]);

	const insertAtCursor = (snippet) => {
		const el = textareaRef.current;
		if (!el) {
			setForm((f) => ({ ...f, html_content: f.html_content + snippet }));
			return;
		}
		const start = el.selectionStart;
		const end = el.selectionEnd;
		const next = form.html_content.slice(0, start) + snippet + form.html_content.slice(end);
		setForm((f) => ({ ...f, html_content: next }));
		requestAnimationFrame(() => {
			el.focus();
			const pos = start + snippet.length;
			el.setSelectionRange(pos, pos);
		});
	};

	const validateForSave = () => {
		if (!form.name.trim()) return t('validation.nameRequired');
		if (!form.subject.trim()) return t('validation.subjectRequired');
		if (!form.html_content.trim()) return t('validation.bodyRequired');
		return null;
	};

	const buildSegmentFilter = () => ({
		segments: form.segments,
		tags: form.tags,
		status: form.status_filter,
	});

	const saveDraft = async () => {
		const v = validateForSave();
		if (v) {
			toast.error(v);
			return null;
		}
		setSaving(true);
		try {
			const payload = {
				name: form.name.trim(),
				subject: form.subject.trim(),
				html_content: form.html_content,
				from_name: form.from_name || DEFAULT_FROM_NAME,
				from_email: form.from_email || DEFAULT_FROM_EMAIL,
				reply_to: form.reply_to || null,
				segment_filter: buildSegmentFilter(),
				recipients_count: recipientCount,
				status: 'draft',
			};
			let result;
			if (isEdit) {
				result = await supabase
					.from('email_campaigns')
					.update(payload)
					.eq('id', id)
					.select('id')
					.single();
			} else {
				result = await supabase
					.from('email_campaigns')
					.insert(payload)
					.select('id')
					.single();
			}
			if (result.error) throw result.error;
			toast.success(t('toast.draftSaved'));
			if (!isEdit) navigate(`/admin/email/campaigns/${result.data.id}/edit`, { replace: true });
			return result.data.id;
		} catch (err) {
			toast.error(err.message || t('toast.saveFailed'));
			return null;
		} finally {
			setSaving(false);
		}
	};

	const sendTest = async () => {
		const v = validateForSave();
		if (v) {
			toast.error(v);
			return;
		}
		if (!adminEmail) {
			toast.error(t('toast.noAdmin'));
			return;
		}
		setSendingTest(true);
		try {
			// Persist a draft first so the worker has something to reference.
			let campaignId = id;
			if (!campaignId) campaignId = await saveDraft();
			if (!campaignId) return;
			await sendCampaign({ campaignId, testTo: adminEmail });
			toast.success(t('toast.testSent', { email: adminEmail }));
		} catch (err) {
			toast.error(err.message || t('toast.testFailed'));
		} finally {
			setSendingTest(false);
		}
	};

	const sendNow = async () => {
		setConfirmSend(false);
		const v = validateForSave();
		if (v) {
			toast.error(v);
			return;
		}
		setSending(true);
		try {
			let campaignId = id;
			if (!campaignId) campaignId = await saveDraft();
			if (!campaignId) return;
			await sendCampaign({ campaignId });
			toast.success(t('toast.queued'));
			navigate('/admin/email/campaigns');
		} catch (err) {
			toast.error(err.message || t('toast.sendFailed'));
		} finally {
			setSending(false);
		}
	};

	const previewHtml = useMemo(() => {
		const base = previewSample && sampleContact
			? substituteSample(form.html_content, sampleContact)
			: highlightPlaceholders(form.html_content);
		const wrapped = `<!doctype html><html><head><meta charset="utf-8"><title>preview</title><style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1c1917;padding:16px;background:#fff;}img{max-width:100%;}</style></head><body>${base}</body></html>`;
		return wrapped;
	}, [form.html_content, previewSample, sampleContact]);

	if (loadingInitial) {
		return (
			<>
				<Navigation />
				<main className="min-h-screen flex items-center justify-center bg-background">
					<Loader2 className="w-10 h-10 text-mango-500 animate-spin" />
				</main>
				<Footer />
			</>
		);
	}

	return (
		<>
			<Helmet>
				<title>{isEdit ? t('seoTitle.edit') : t('seoTitle.create')}</title>
			</Helmet>
			<Navigation />
			<main id="main" role="main" className="min-h-screen bg-background pt-32 pb-20 px-4 sm:px-6 lg:px-8">
				<div className="max-w-7xl mx-auto">
					<div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
						<div>
							<Link to="/admin/email/campaigns" className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-foreground/60 hover:text-foreground mb-3">
								<ArrowLeft className="w-3 h-3" /> {t('backToCampaigns')}
							</Link>
							<h1 className="text-3xl sm:text-4xl font-light text-foreground flex items-center gap-3">
								<Mail className="w-8 h-8 text-mango-500" /> {isEdit ? t('heading.edit') : t('heading.create')}
							</h1>
						</div>
					</div>

					{error && (
						<div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 flex items-start gap-2">
							<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
							<span>{error}</span>
						</div>
					)}

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
						{/* LEFT: form */}
						<div className="space-y-5">
							<Field label={t('fields.name')}>
								<input
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
									placeholder={t('fields.namePlaceholder')}
								/>
							</Field>
							<Field label={t('fields.subject')}>
								<input
									value={form.subject}
									onChange={(e) => setForm({ ...form, subject: e.target.value })}
									className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
								/>
							</Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label={t('fields.fromName')}>
									<input
										value={form.from_name}
										onChange={(e) => setForm({ ...form, from_name: e.target.value })}
										readOnly
										className="w-full px-3 py-2 rounded-md bg-card/60 border border-foreground/10 text-foreground/70 text-sm"
									/>
								</Field>
								<Field label={t('fields.fromEmail')}>
									<input
										value={form.from_email}
										onChange={(e) => setForm({ ...form, from_email: e.target.value })}
										readOnly
										className="w-full px-3 py-2 rounded-md bg-card/60 border border-foreground/10 text-foreground/70 text-sm"
									/>
								</Field>
							</div>
							<Field label={t('fields.replyTo')}>
								<input
									value={form.reply_to}
									onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
									className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground text-sm"
									placeholder={t('fields.replyToPlaceholder')}
								/>
							</Field>

							{/* Audience builder */}
							<div className="rounded-2xl border border-foreground/10 bg-card/40 p-4">
								<div className="text-xs uppercase tracking-widest text-foreground/50 mb-3">{t('audience.title')}</div>
								<div className="flex flex-wrap gap-2 mb-3">
									{['b2b', 'individual'].map((s) => {
										const on = form.segments.includes(s);
										return (
											<button
												key={s}
												type="button"
												onClick={() =>
													setForm((f) => ({
														...f,
														segments: on ? f.segments.filter((x) => x !== s) : [...f.segments, s],
													}))
												}
												className={`px-3 py-1.5 rounded-full text-xs border transition ${
													on
														? 'bg-mango-500/20 text-mango-300 border-mango-500/40'
														: 'bg-card border-foreground/10 text-foreground/60 hover:text-foreground'
												}`}
											>
												{s}
											</button>
										);
									})}
								</div>
								{knownTags.length > 0 && (
									<>
										<div className="text-xs text-foreground/50 mb-2">{t('audience.tagsLabel')}</div>
										<div className="flex flex-wrap gap-2 mb-3">
											{knownTags.map((t) => {
												const on = form.tags.includes(t);
												return (
													<button
														key={t}
														type="button"
														onClick={() =>
															setForm((f) => ({
																...f,
																tags: on ? f.tags.filter((x) => x !== t) : [...f.tags, t],
															}))
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
										</div>
									</>
								)}
								<div className="flex items-center gap-2 mb-3">
									<span className="text-xs text-foreground/50">{t('audience.statusLabel')}</span>
									{['active', 'unsubscribed', 'bounced'].map((s) => (
										<label key={s} className="flex items-center gap-1 text-xs text-foreground/70">
											<input
												type="radio"
												name="status_filter"
												checked={form.status_filter === s}
												onChange={() => setForm({ ...form, status_filter: s })}
											/>
											{t(`audience.status.${s}`)}
										</label>
									))}
								</div>
								<div className="text-sm text-foreground/80">
									{recipientLoading ? (
										<Loader2 className="w-4 h-4 animate-spin inline" />
									) : (
										<>
											<span className="text-mango-400 font-medium">{recipientCount}</span>{recipientCount === 1 ? t('audience.recipientSuffix') : t('audience.recipientSuffixPlural')}
										</>
									)}
								</div>
							</div>

							{/* Personalization */}
							{mergeVarKeys.length > 0 && (
								<div>
									<div className="text-xs uppercase tracking-widest text-foreground/50 mb-2">
										{t('personalization.title')}
									</div>
									<div className="flex flex-wrap gap-2">
										{['first_name', 'last_name', 'email', ...mergeVarKeys].map((k) => (
											<button
												key={k}
												type="button"
												onClick={() => insertAtCursor(`{{params.${k}}}`)}
												className="px-2 py-1 rounded-full text-xs bg-card border border-foreground/10 text-foreground/70 hover:text-foreground"
											>
												{`{{params.${k}}}`}
											</button>
										))}
									</div>
								</div>
							)}

							<Field label={t('fields.htmlBody')}>
								<textarea
									ref={textareaRef}
									value={form.html_content}
									onChange={(e) => setForm({ ...form, html_content: e.target.value })}
									rows={20}
									className="w-full px-3 py-2 rounded-md bg-card border border-foreground/10 text-foreground font-mono text-xs focus:outline-none focus:ring-2 focus:ring-mango-500/40"
									placeholder={`<p>Hi {{params.first_name}},</p>\n<p>...</p>`}
								/>
							</Field>

							<div className="flex flex-wrap gap-3 pt-2">
								<Button onClick={saveDraft} disabled={saving} variant="ghost" className="border border-foreground/10 text-foreground">
									{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
									{t('buttons.saveDraft')}
								</Button>
								<Button
									onClick={sendTest}
									disabled={sendingTest || !adminEmail}
									variant="ghost"
									className="border border-foreground/10 text-foreground"
								>
									{sendingTest ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
									{t('buttons.sendTest')}
								</Button>
								<Button
									onClick={() => setConfirmSend(true)}
									disabled={sending || recipientCount === 0}
									className="bg-mango-500 hover:bg-mango-600 text-stone-900"
								>
									{sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
									{t('buttons.sendCampaign')}
								</Button>
							</div>
						</div>

						{/* RIGHT: preview */}
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<div className="text-xs uppercase tracking-widest text-foreground/50">{t('preview.label')}</div>
								<label className="flex items-center gap-2 text-xs text-foreground/70">
									<input
										type="checkbox"
										checked={previewSample}
										onChange={(e) => setPreviewSample(e.target.checked)}
										disabled={!sampleContact}
									/>
									{t('preview.withSample')}
									{sampleContact && (
										<span className="text-foreground/40">({sampleContact.email})</span>
									)}
								</label>
							</div>
							<iframe
								title={t('preview.iframeTitle')}
								sandbox=""
								srcDoc={previewHtml}
								className="w-full min-h-[640px] bg-white rounded-2xl border border-foreground/10"
							/>
						</div>
					</div>
				</div>
			</main>

			{confirmSend && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmSend(false)}>
					<div
						className="bg-card border border-foreground/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-3">
							<h2 className="text-xl font-light text-foreground">{t('confirm.title')}</h2>
							<button onClick={() => setConfirmSend(false)} className="text-foreground/50 hover:text-foreground">
								<X className="w-5 h-5" />
							</button>
						</div>
						<p className="text-foreground/70 text-sm mb-5">
							{t(recipientCount === 1 ? 'confirm.body' : 'confirm.bodyPlural', { count: recipientCount })}
						</p>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => setConfirmSend(false)} className="border border-foreground/10 text-foreground">
								{t('buttons.cancel')}
							</Button>
							<Button onClick={sendNow} className="bg-mango-500 hover:bg-mango-600 text-stone-900">
								{t('confirm.send', { count: recipientCount })}
							</Button>
						</div>
					</div>
				</div>
			)}

			<Footer />
		</>
	);
};

const Field = ({ label, children }) => (
	<div>
		<label className="text-xs uppercase tracking-widest text-foreground/50 block mb-2">{label}</label>
		{children}
	</div>
);

export default EmailComposerPage;
