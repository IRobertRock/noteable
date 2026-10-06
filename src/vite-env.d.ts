declare const __APP_VERSION__: string;

interface UserActivation {
  readonly isActive: boolean;
  readonly hasBeenActive: boolean;
}
interface Navigator {
  readonly userActivation?: UserActivation;
}
