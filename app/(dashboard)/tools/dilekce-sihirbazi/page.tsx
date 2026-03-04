import { PetitionDraftingWizard } from '@/components/tools/petition-drafting-wizard';

export const metadata = {
  title: 'Dilekce Sihirbazi | Babylexit',
  description: 'Yapilandirilmis veri ile guvenli dilekce taslagi olusturma araci',
};

export default function PetitionWizardPage() {
  return <PetitionDraftingWizard />;
}
