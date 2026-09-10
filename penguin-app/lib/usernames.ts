// Username / email conventions: first initial + last name, firstname.lastname@versantmedia.com
export const EMAIL_DOMAIN = process.env.NEXT_PUBLIC_EMAIL_DOMAIN || process.env.EMAIL_DOMAIN || "versantmedia.com";

export const autoUsername = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return (parts[0] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (parts[0][0] + parts[parts.length - 1]).toLowerCase().replace(/[^a-z0-9]/g, "");
};

export const autoEmail = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ? `${parts[0].toLowerCase().replace(/[^a-z0-9]/g, "")}@${EMAIL_DOMAIN}` : "";
  return `${parts[0]}.${parts[parts.length - 1]}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + `@${EMAIL_DOMAIN}`;
};
