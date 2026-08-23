import {
  ArrowLeft,
  ArrowRight,
  FileText,
  PencilSimple,
  Plus,
  SignIn,
} from "@phosphor-icons/react/ssr";

const decorative = {
  size: 20,
  weight: "light",
  "aria-hidden": true,
} as const;

export function PencilSimpleIcon() {
  return <PencilSimple {...decorative} />;
}

export function FileTextIcon() {
  return <FileText {...decorative} />;
}

export function ArrowLeftIcon() {
  return <ArrowLeft {...decorative} />;
}

export function ArrowRightIcon() {
  return <ArrowRight {...decorative} />;
}

export function PlusIcon() {
  return <Plus {...decorative} />;
}

export function SignInIcon() {
  return <SignIn {...decorative} />;
}
