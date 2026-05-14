import React, { useState } from 'react';
import { m } from 'framer-motion';
import { Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { subscribeToNewsletter } from '@/services/NewsletterService';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

// Brand-portable. ALL user-facing copy is overridable from the parent:
//   - <NewsletterSignup headline=... subtext=... buttonText=... successMessage="..." />
// If you don't pass props, falls back to i18n namespace `newsletter`
// (see frontend/src/i18n/locales/{es,en}/newsletter.json). Most consumers
// should pass `successMessage` so the toast/confirmation reflects their
// brand name (the default i18n value is generic on purpose).
const NewsletterSignup = ({
  headline,
  subtext,
  fields = { firstName: true, email: true },
  buttonText,
  source = "General Signup",
  successMessage,
  variant = "default", // default (light bg), hero (dark bg), footer (compact)
  tags = []
}) => {
  const { t } = useTranslation('newsletter');
  const [formData, setFormData] = useState({ firstName: '', email: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();
  const resolvedButtonText = buttonText || t('defaultButton');
  const resolvedSuccessMessage = successMessage || t('defaultSuccessMessage');

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await subscribeToNewsletter({
        firstName: formData.firstName,
        email: formData.email,
        source,
        tags
      });

      if (result.success) {
        setIsSuccess(true);
        toast({
          title: t('toast.successTitle'),
          description: resolvedSuccessMessage,
          className: "bg-[#D4A574] text-foreground border-none",
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: t('toast.errorTitle'),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <m.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "text-center p-8 rounded-2xl border",
          variant === 'hero' ? "bg-foreground/10 backdrop-blur-md border-foreground/20 text-foreground" : "bg-stone-50 border-stone-100 text-stone-900"
        )}
      >
        <CheckCircle2 className={cn("w-12 h-12 mx-auto mb-4", variant === 'hero' ? "text-[#D4A574]" : "text-[#D4A574]")} />
        <h3 className="text-2xl font-normal mb-2">{t('successTitle')}</h3>
        <p className={variant === 'hero' ? "text-foreground/80 font-normal" : "text-stone-600 font-normal"}>{resolvedSuccessMessage}</p>
      </m.div>
    );
  }

  const isHero = variant === 'hero';
  const isFooter = variant === 'footer';

  return (
    <div className={cn(
      "w-full max-w-xl mx-auto",
      isFooter ? "max-w-md" : ""
    )}>
      {headline && (
        <h2 className={cn(
          "font-normal mb-3",
          isHero ? "text-3xl md:text-4xl text-foreground leading-tight" : "text-2xl md:text-3xl text-stone-900",
          isFooter && "text-lg text-foreground mb-2"
        )}>
          {headline}
        </h2>
      )}
      
      {subtext && (
        <p className={cn(
          "mb-6 font-light",
          isHero ? "text-lg text-foreground/90" : "text-stone-600",
          isFooter && "text-sm text-foreground/70 mb-4"
        )}>
          {subtext}
        </p>
      )}

      <form onSubmit={handleSubmit} className={cn(
        "flex gap-3",
        isFooter ? "flex-col sm:flex-row" : "flex-col"
      )}>
        <div className={cn("flex flex-col gap-3", !isFooter && "sm:flex-row")}>
          {fields.firstName && (
            <input
              type="text"
              name="firstName"
              placeholder={t('firstNamePlaceholder')}
              value={formData.firstName}
              onChange={handleChange}
              required
              className={cn(
                "flex-1 px-4 py-3 rounded-lg border outline-none transition-all duration-300 font-light",
                isHero 
                  ? "bg-foreground/10 border-foreground/20 text-foreground placeholder:text-foreground/60 focus:bg-foreground/20 focus:border-[#D4A574]" 
                  : "bg-white border-stone-200 text-stone-900 placeholder:text-stone-400 focus:border-[#D4A574] focus:ring-1 focus:ring-[#D4A574]",
                isFooter && "bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/40"
              )}
            />
          )}
          
          {fields.email && (
            <input
              type="email"
              name="email"
              placeholder={t('emailPlaceholder')}
              value={formData.email}
              onChange={handleChange}
              required
              className={cn(
                "flex-1 px-4 py-3 rounded-lg border outline-none transition-all duration-300 font-light",
                isHero 
                  ? "bg-foreground/10 border-foreground/20 text-foreground placeholder:text-foreground/60 focus:bg-foreground/20 focus:border-[#D4A574]" 
                  : "bg-white border-stone-200 text-stone-900 placeholder:text-stone-400 focus:border-[#D4A574] focus:ring-1 focus:ring-[#D4A574]",
                isFooter && "bg-foreground/5 border-foreground/10 text-foreground placeholder:text-foreground/40"
              )}
            />
          )}
        </div>

        <Button 
          type="submit" 
          disabled={isLoading}
          className={cn(
            "w-full sm:w-auto font-normal transition-all duration-300",
            isHero 
              ? "bg-[#D4A574] hover:bg-[#c29462] text-foreground py-6 text-lg shadow-lg hover:shadow-[#D4A574]/30" 
              : "bg-[#D4A574] hover:bg-[#c29462] text-foreground py-6",
            isFooter && "py-3 bg-foreground/10 hover:bg-foreground/20 text-foreground border border-foreground/20 hover:border-foreground/40"
          )}
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <span className="flex items-center justify-center gap-2">
              {resolvedButtonText} {isHero && <ArrowRight className="w-5 h-5" />}
            </span>
          )}
        </Button>
      </form>

      <p className={cn(
        "mt-4 text-xs font-light",
        isHero ? "text-foreground/50" : "text-stone-400",
        isFooter && "text-foreground/30"
      )}>
        {t('consent.prefix')}<Link to="/privacy" className="underline hover:text-[#D4A574]">{t('consent.privacyLink')}</Link>{t('consent.suffix')}
      </p>
    </div>
  );
};

export default NewsletterSignup;