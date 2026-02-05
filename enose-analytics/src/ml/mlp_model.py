"""MLP 模型定义"""

from typing import Any

import torch
import torch.nn as nn



class MLPClassifier(nn.Module):
    """多层感知机分类器"""

    def __init__(
        self,
        input_dim: int,
        output_dim: int,
        hidden_layers: list[int] | None = None,
        activation: str = "relu",
        dropout: float = 0.2,
    ):
        super().__init__()

        self.input_dim = input_dim
        self.output_dim = output_dim
        self.hidden_layers = hidden_layers or [64, 32]
        self.activation_name = activation
        self.dropout_rate = dropout

        # 构建网络
        layers: list[nn.Module] = []
        prev_dim = input_dim

        for hidden_dim in self.hidden_layers:
            layers.append(nn.Linear(prev_dim, hidden_dim))
            layers.append(self._get_activation(activation))
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev_dim = hidden_dim

        # 输出层
        layers.append(nn.Linear(prev_dim, output_dim))

        self.network = nn.Sequential(*layers)

    def _get_activation(self, name: str) -> nn.Module:
        """获取激活函数"""
        activations = {
            "relu": nn.ReLU(),
            "leaky_relu": nn.LeakyReLU(0.1),
            "elu": nn.ELU(),
            "gelu": nn.GELU(),
            "tanh": nn.Tanh(),
            "sigmoid": nn.Sigmoid(),
        }
        return activations.get(name.lower(), nn.ReLU())

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """前向传播"""
        return self.network(x)

    def predict(self, x: torch.Tensor) -> torch.Tensor:
        """预测 (返回类别索引)"""
        self.eval()
        with torch.no_grad():
            logits = self.forward(x)
            return torch.argmax(logits, dim=1)

    def predict_proba(self, x: torch.Tensor) -> torch.Tensor:
        """预测概率"""
        self.eval()
        with torch.no_grad():
            logits = self.forward(x)
            return torch.softmax(logits, dim=1)

    def get_config(self) -> dict[str, Any]:
        """获取模型配置"""
        return {
            "input_dim": self.input_dim,
            "output_dim": self.output_dim,
            "hidden_layers": self.hidden_layers,
            "activation": self.activation_name,
            "dropout": self.dropout_rate,
        }

    @classmethod
    def from_config(cls, config: dict[str, Any]) -> "MLPClassifier":
        """从配置创建模型"""
        return cls(
            input_dim=config["input_dim"],
            output_dim=config["output_dim"],
            hidden_layers=config.get("hidden_layers", [64, 32]),
            activation=config.get("activation", "relu"),
            dropout=config.get("dropout", 0.2),
        )

    def save(self, path: str) -> None:
        """保存模型"""
        torch.save(
            {
                "state_dict": self.state_dict(),
                "config": self.get_config(),
            },
            path,
        )
        logger.info(f"Model saved to {path}")

    @classmethod
    def load(cls, path: str, map_location: str = "cpu") -> "MLPClassifier":
        """加载模型"""
        checkpoint = torch.load(path, map_location=map_location)
        model = cls.from_config(checkpoint["config"])
        model.load_state_dict(checkpoint["state_dict"])
        logger.info(f"Model loaded from {path}")
        return model

    def to_bytes(self) -> bytes:
        """序列化为字节"""
        import io

        buffer = io.BytesIO()
        torch.save(
            {
                "state_dict": self.state_dict(),
                "config": self.get_config(),
            },
            buffer,
        )
        return buffer.getvalue()

    @classmethod
    def from_bytes(cls, data: bytes, map_location: str = "cpu") -> "MLPClassifier":
        """从字节反序列化"""
        import io

        buffer = io.BytesIO(data)
        checkpoint = torch.load(buffer, map_location=map_location)
        model = cls.from_config(checkpoint["config"])
        model.load_state_dict(checkpoint["state_dict"])
        return model
