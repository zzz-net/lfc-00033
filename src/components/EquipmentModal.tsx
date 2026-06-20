import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Equipment } from "@/types";

interface Props {
  equipment: Equipment | null;
  onClose: () => void;
  onSubmit: (data: { name: string; type: string; deposit_amount: number; notes: string }) => Promise<void>;
}

export default function EquipmentModal({ equipment, onClose, onSubmit }: Props) {
  const isEdit = !!equipment;
  const [name, setName] = useState(equipment?.name || "");
  const [type, setType] = useState(equipment?.type || "");
  const [deposit_amount, setDepositAmount] = useState(
    equipment?.deposit_amount?.toString() || ""
  );
  const [notes, setNotes] = useState(equipment?.notes || "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        type,
        deposit_amount: parseFloat(deposit_amount) || 0,
        notes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? "编辑设备" : "添加设备"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">设备名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="请输入设备名称"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">设备类型</label>
            <input
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="如：口腔镜、消毒锅等"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">押金金额（元）</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={deposit_amount}
              onChange={(e) => setDepositAmount(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
              placeholder="可选备注信息"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-outline">
              取消
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "提交中..." : isEdit ? "保存" : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
