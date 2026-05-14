import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion as m } from 'framer-motion';
import {
	LineChart,
	Line,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	ResponsiveContainer,
	Legend,
} from 'recharts';
import {
	Loader2,
	RefreshCw,
	ArrowLeft,
	Mail,
	Users,
	Send,
	TrendingUp,
	MailOpen,
	AlertTriangle,
	UserCircle,
	Building2,
	PlusCircle,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';

const dayKey = (iso) => {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const pct = (num, den) => {
	if (!den) return 0;
	return Math.round((num / den) * 1000) / 10;
};

const StatusColors = {
	sent: '#facc15',
	delivered: '#34d399',
	opened: '#60a5fa',
	clicked: '#a78bfa',
	bounced: '#f87171',
	unsubscribed: '#94a3b8',
};

const EmailDashboardPage = () => {
	const { t } = useTranslation('adminEmailDashboard');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [kpis, setKpis] = useState({
		totalContacts: 0,
		campaignsSent: 0,
		deliverability: 0,
		openRate: 0,
	});
	const [perDay, setPerDay] = useState([]);
	const [statusDist, setStatusDist] = useState([]);
	const [comparison, setComparison] = useState({
		b2b: { count: 0, opens: 0, delivered: 0, bounces: 0 },
		individual: { count: 0, opens: 0, delivered: 0, bounces: 0 },
	});
	const [topBouncing, setTopBouncing] = useState([]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
			const isoFloor = thirtyDaysAgo.toISOString();

			const [contactsRes, campaignsRes, logsRes] = await Promise.all([
				supabase
					.from('email_contacts')
					.select('id, segment, status', { count: 'exact' })
					.eq('status', 'active'),
				supabase
					.from('email_campaigns')
					.select('id', { count: 'exact', head: true })
					.eq('status', 'sent'),
				supabase
					.from('email_logs')
					.select('id, status, campaign_type, sent_at, created_at, recipient')
					.gte('created_at', isoFloor)
					.limit(20000),
			]);

			if (contactsRes.error) throw contactsRes.error;
			if (campaignsRes.error) throw campaignsRes.error;
			if (logsRes.error) throw logsRes.error;

			const logs = logsRes.data || [];

			// Aggregate counts by status.
			const counts = {
				sent: 0,
				delivered: 0,
				opened: 0,
				clicked: 0,
				bounced: 0,
				unsubscribed: 0,
			};
			for (const r of logs) {
				if (counts[r.status] !== undefined) counts[r.status] += 1;
			}

			// Per-day series by campaign_type — only "sent" rows count toward volume.
			const dayMap = new Map(); // day -> { day, b2b, individual }
			const days = [];
			for (let i = 29; i >= 0; i -= 1) {
				const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
				const key = dayKey(d.toISOString());
				dayMap.set(key, { day: key.slice(5), b2b: 0, individual: 0 });
				days.push(key);
			}
			for (const r of logs) {
				if (!r.sent_at) continue;
				const k = dayKey(r.sent_at);
				const slot = dayMap.get(k);
				if (!slot) continue;
				if (r.campaign_type === 'b2b') slot.b2b += 1;
				else if (r.campaign_type === 'individual') slot.individual += 1;
			}
			const perDayArr = days.map((d) => dayMap.get(d));

			// Comparison panel by segment.
			const cmp = {
				b2b: { count: 0, opens: 0, delivered: 0, bounces: 0 },
				individual: { count: 0, opens: 0, delivered: 0, bounces: 0 },
			};
			for (const r of logs) {
				const t = r.campaign_type;
				if (t !== 'b2b' && t !== 'individual') continue;
				cmp[t].count += 1;
				if (r.status === 'delivered' || r.status === 'opened' || r.status === 'clicked') {
					cmp[t].delivered += 1;
				}
				if (r.status === 'opened' || r.status === 'clicked') cmp[t].opens += 1;
				if (r.status === 'bounced' || r.status === 'soft_bounced') cmp[t].bounces += 1;
			}

			// Top 5 bouncing domains.
			const domainCounts = new Map();
			for (const r of logs) {
				if (r.status !== 'bounced' && r.status !== 'soft_bounced') continue;
				const at = String(r.recipient || '').split('@')[1];
				if (!at) continue;
				domainCounts.set(at, (domainCounts.get(at) || 0) + 1);
			}
			const topDomains = Array.from(domainCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5)
				.map(([domain, count]) => ({ domain, count }));

			setKpis({
				totalContacts: contactsRes.count || (contactsRes.data?.length ?? 0),
				campaignsSent: campaignsRes.count || 0,
				deliverability: pct(counts.delivered + counts.opened + counts.clicked, counts.sent || (counts.delivered + counts.opened + counts.clicked + counts.bounced)),
				openRate: pct(counts.opened + counts.clicked, counts.delivered + counts.opened + counts.clicked),
			});
			setPerDay(perDayArr);
			setStatusDist(
				Object.entries(counts).map(([status, count]) => ({ status, count })),
			);
			setComparison(cmp);
			setTopBouncing(topDomains);
		} catch (err) {
			setError(err.message || t('errors.loadFailed'));
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		load();
	}, [load]);

	const comparisonCards = useMemo(() => {
		const make = (label, icon, data) => ({
			label,
			icon,
			count: data.count,
			openRate: pct(data.opens, data.delivered || data.count),
			bounceRate: pct(data.bounces, data.count),
		});
		return [
			make(t('comparison.b2b'), Building2, comparison.b2b),
			make(t('comparison.individual'), UserCircle, comparison.individual),
		];
	}, [comparison, t]);

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
								to="/dashboard/blog"
								className="inline-flex items-center gap-1 text-xs uppercase tracking-widest text-foreground/60 hover:text-foreground mb-3"
							>
								<ArrowLeft className="w-3 h-3" /> {t('backToDashboard')}
							</Link>
							<h1 className="text-3xl sm:text-4xl font-light text-foreground flex items-center gap-3">
								<Mail className="w-8 h-8 text-mango-500" /> {t('heading')}
							</h1>
							<p className="text-foreground/60 mt-2 font-light">
								{t('subheading')}
							</p>
						</div>
						<div className="flex gap-3">
							<Button
								onClick={load}
								variant="ghost"
								className="border border-foreground/10 text-foreground"
							>
								<RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> {t('buttons.refresh')}
							</Button>
						</div>
					</div>

					{error && (
						<div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 flex items-start gap-2">
							<AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
							<span>{error}</span>
						</div>
					)}

					{/* KPI row */}
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
						<KpiTile loading={loading} icon={Users} label={t('kpis.activeContacts')} value={kpis.totalContacts} />
						<KpiTile loading={loading} icon={Send} label={t('kpis.campaignsSent')} value={kpis.campaignsSent} />
						<KpiTile
							loading={loading}
							icon={TrendingUp}
							label={t('kpis.deliverability30d')}
							value={`${kpis.deliverability}%`}
						/>
						<KpiTile
							loading={loading}
							icon={MailOpen}
							label={t('kpis.openRate30d')}
							value={`${kpis.openRate}%`}
						/>
					</div>

					{/* Quick actions */}
					<div className="flex flex-wrap gap-3 mb-10">
						<Link to="/admin/email/contacts">
							<Button variant="ghost" className="border border-foreground/10 text-foreground">
								<Users className="w-4 h-4 mr-2" /> {t('buttons.manageContacts')}
							</Button>
						</Link>
						<Link to="/admin/email/campaigns">
							<Button variant="ghost" className="border border-foreground/10 text-foreground">
								<Send className="w-4 h-4 mr-2" /> {t('buttons.allCampaigns')}
							</Button>
						</Link>
						<Link to="/admin/email/campaigns/new">
							<Button className="bg-mango-500 hover:bg-mango-600 text-stone-900">
								<PlusCircle className="w-4 h-4 mr-2" /> {t('buttons.newCampaign')}
							</Button>
						</Link>
					</div>

					{/* Charts */}
					<m.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.4 }}
						className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
					>
						<div className="rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm p-5">
							<h2 className="text-sm uppercase tracking-widest text-foreground/60 mb-4">
								{t('charts.emailsSent30d')}
							</h2>
							{loading ? (
								<div className="flex items-center justify-center h-72">
									<Loader2 className="w-6 h-6 animate-spin text-foreground/40" />
								</div>
							) : (
								<ResponsiveContainer width="100%" height={280}>
									<LineChart data={perDay}>
										<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
										<XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" fontSize={11} />
										<YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
										<Tooltip
											contentStyle={{
												background: '#1c1917',
												border: '1px solid rgba(255,255,255,0.1)',
												borderRadius: 8,
											}}
										/>
										<Legend />
										<Line type="monotone" dataKey="b2b" stroke="#facc15" strokeWidth={2} dot={false} />
										<Line
											type="monotone"
											dataKey="individual"
											stroke="#60a5fa"
											strokeWidth={2}
											dot={false}
										/>
									</LineChart>
								</ResponsiveContainer>
							)}
						</div>

						<div className="rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm p-5">
							<h2 className="text-sm uppercase tracking-widest text-foreground/60 mb-4">
								{t('charts.statusDistribution')}
							</h2>
							{loading ? (
								<div className="flex items-center justify-center h-72">
									<Loader2 className="w-6 h-6 animate-spin text-foreground/40" />
								</div>
							) : (
								<ResponsiveContainer width="100%" height={280}>
									<BarChart data={statusDist}>
										<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
										<XAxis dataKey="status" stroke="rgba(255,255,255,0.4)" fontSize={11} />
										<YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
										<Tooltip
											contentStyle={{
												background: '#1c1917',
												border: '1px solid rgba(255,255,255,0.1)',
												borderRadius: 8,
											}}
										/>
										<Bar dataKey="count">
											{statusDist.map((entry) => (
												<rect
													key={entry.status}
													fill={StatusColors[entry.status] || '#94a3b8'}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							)}
						</div>
					</m.div>

					{/* Comparison + top bouncing domains */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<div className="rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm p-5">
							<h2 className="text-sm uppercase tracking-widest text-foreground/60 mb-4">
								{t('comparison.title')}
							</h2>
							<div className="grid grid-cols-2 gap-4">
								{comparisonCards.map(({ label, icon: Icon, count, openRate, bounceRate }) => (
									<div
										key={label}
										className="rounded-xl border border-foreground/10 bg-background/40 p-4"
									>
										<div className="flex items-center gap-2 text-foreground/70 text-sm mb-3">
											<Icon className="w-4 h-4 text-mango-400" /> {label}
										</div>
										<dl className="space-y-2 text-sm">
											<div className="flex justify-between">
												<dt className="text-foreground/50">{t('comparison.recipients')}</dt>
												<dd className="text-foreground">{count}</dd>
											</div>
											<div className="flex justify-between">
												<dt className="text-foreground/50">{t('comparison.openRate')}</dt>
												<dd className="text-foreground">{openRate}%</dd>
											</div>
											<div className="flex justify-between">
												<dt className="text-foreground/50">{t('comparison.bounceRate')}</dt>
												<dd className="text-foreground">{bounceRate}%</dd>
											</div>
										</dl>
									</div>
								))}
							</div>
						</div>

						<div className="rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm p-5">
							<h2 className="text-sm uppercase tracking-widest text-foreground/60 mb-4">
								{t('bouncing.title')}
							</h2>
							{loading ? (
								<div className="flex items-center justify-center h-40">
									<Loader2 className="w-6 h-6 animate-spin text-foreground/40" />
								</div>
							) : topBouncing.length === 0 ? (
								<p className="text-foreground/50 text-sm italic">{t('bouncing.noBounces')}</p>
							) : (
								<table className="w-full text-sm">
									<thead className="text-foreground/50 uppercase text-xs tracking-wider">
										<tr>
											<th className="text-left py-2">{t('bouncing.domain')}</th>
											<th className="text-right py-2">{t('bouncing.bounces')}</th>
										</tr>
									</thead>
									<tbody>
										{topBouncing.map((d) => (
											<tr key={d.domain} className="border-t border-foreground/5">
												<td className="py-2 text-foreground/80">{d.domain}</td>
												<td className="py-2 text-right text-foreground">{d.count}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</div>
				</div>
			</main>
			<Footer />
		</>
	);
};

const KpiTile = ({ loading, icon: Icon, label, value }) => (
	<div className="rounded-2xl border border-foreground/10 bg-card/40 backdrop-blur-sm p-5">
		<div className="text-xs uppercase tracking-widest text-foreground/50 flex items-center gap-2">
			{Icon ? <Icon className="w-3.5 h-3.5" /> : null} {label}
		</div>
		<div className="mt-2 text-3xl font-light text-foreground">
			{loading ? <Loader2 className="w-5 h-5 animate-spin text-foreground/40" /> : value}
		</div>
	</div>
);

export default EmailDashboardPage;
